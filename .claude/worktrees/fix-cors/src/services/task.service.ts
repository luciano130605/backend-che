import { prisma } from "../config/prisma";
import { DEFAULT_TIME_ZONE, hasExplicitTime } from "./zoned-date";
import { removeTaskEvent, syncTaskSafe } from "./calendar.service";

export class TaskError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "TaskError";
  }
}

interface CreateTaskInput {
  title: string;
  rawText?: string;
  categoryId?: string;
  dueDate?: Date;
  priority?: "LOW" | "MEDIUM" | "HIGH";
}

interface UpdateTaskInput {
  title?: string;
  categoryId?: string | null;
  dueDate?: Date | null;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  status?: "PENDING" | "DONE" | "DISMISSED";
}

interface ListTasksFilters {
  status?: "PENDING" | "DONE" | "DISMISSED";
  categoryId?: string;
  upcoming?: boolean;
  // Lo que ya no está en la lista principal: hechas y vencidas. Tiene prioridad sobre "upcoming".
  history?: boolean;
}

const VISIBLE_AFTER_DUE_MS = 24 * 60 * 60 * 1000;
const NO_DUE_DATE_VISIBLE_DAYS = 7;
const REMINDER_LEAD_MINUTES = 60;
const HISTORY_LIMIT = 100;

export async function getUserTimeZone(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  return user?.timeZone ?? DEFAULT_TIME_ZONE;
}

// Solo las tareas con hora tienen aviso puntual; las de "todo el día" las cubre el resumen diario.
export function computeReminderAt(
  dueDate: Date | null | undefined,
  timeZone: string,
  now = new Date(),
): Date | null {
  if (!dueDate || !hasExplicitTime(dueDate, timeZone) || dueDate <= now) return null;

  const remindAt = new Date(dueDate.getTime() - REMINDER_LEAD_MINUTES * 60_000);
  return remindAt > now ? remindAt : now;
}

async function assertCategoryExists(categoryId?: string | null) {
  if (!categoryId) return;
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) {
    throw new TaskError("La categoría indicada no existe.", 404);
  }
}

export async function createTask(userId: string, input: CreateTaskInput, timeZone?: string) {
  await assertCategoryExists(input.categoryId);
  const zone = timeZone ?? (await getUserTimeZone(userId));

  const task = await prisma.task.create({
    data: {
      userId,
      title: input.title,
      rawText: input.rawText ?? input.title,
      categoryId: input.categoryId,
      dueDate: input.dueDate,
      reminderAt: computeReminderAt(input.dueDate, zone),
      priority: input.priority,
    },
    include: { category: true },
  });
  syncTaskSafe(task.id);
  return task;
}

// Trae siempre por usuario/status/categoría en la consulta a la DB; el filtro
// "upcoming" se aplica en memoria porque combina condiciones sobre distintos
// campos (dueDate, status, updatedAt, createdAt) que Prisma no resuelve bien
// en un único where dinámico legible.
export async function listTasks(userId: string, filters: ListTasksFilters) {
  if (filters.history) return listHistory(userId, filters);

  const tasks = await prisma.task.findMany({
    where: {
      userId,
      status: filters.status,
      categoryId: filters.categoryId,
    },
    include: { category: true },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });

  if (!filters.upcoming) return tasks;

  const now = Date.now();
  const hoursSince = (date: Date) => (now - date.getTime()) / (1000 * 60 * 60);

  return tasks.filter((task) => {
    if (task.status === "DISMISSED") return false;
    if (task.status === "DONE") {
      return hoursSince(task.updatedAt) < 24;
    }

    if (!task.dueDate) {
      return hoursSince(task.createdAt) < NO_DUE_DATE_VISIBLE_DAYS * 24;
    }

    // Con hora: sale 24 h después. Solo fecha: el instante guardado es la medianoche
    // de ese día, así que +24 h es el día siguiente. Misma regla para los dos casos.
    return now < task.dueDate.getTime() + VISIBLE_AFTER_DUE_MS;
  });
}

// Historial = todo lo que resolvió el usuario, más lo pendiente que "upcoming" ya dejó de mostrar
// (vencido hace más de 24 h, o sin fecha y con más de 7 días). Son las mismas reglas de arriba, en SQL.
function listHistory(userId: string, filters: ListTasksFilters) {
  const now = Date.now();

  return prisma.task.findMany({
    where: {
      userId,
      status: filters.status,
      categoryId: filters.categoryId,
      OR: [
        { status: "DONE" },
        { status: "PENDING", dueDate: { lt: new Date(now - VISIBLE_AFTER_DUE_MS) } },
        {
          status: "PENDING",
          dueDate: null,
          createdAt: { lt: new Date(now - NO_DUE_DATE_VISIBLE_DAYS * 24 * 60 * 60 * 1000) },
        },
      ],
    },
    include: { category: true },
    orderBy: { updatedAt: "desc" },
    take: HISTORY_LIMIT,
  });
}

async function findOwnedTask(userId: string, taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });

  if (!task) {
    throw new TaskError("Tarea no encontrada.", 404);
  }

  if (task.userId !== userId) {
    // 404 en vez de 403: no confirmamos que la tarea existe si es de otro usuario
    throw new TaskError("Tarea no encontrada.", 404);
  }

  return task;
}

export async function getTaskById(userId: string, taskId: string) {
  const task = await findOwnedTask(userId, taskId);
  return prisma.task.findUnique({
    where: { id: task.id },
    include: { category: true },
  });
}

export async function updateTask(userId: string, taskId: string, input: UpdateTaskInput) {
  await findOwnedTask(userId, taskId);
  await assertCategoryExists(input.categoryId);

  // Si cambia la fecha, se recalcula el aviso y se habilita de nuevo.
  const reminder =
    input.dueDate !== undefined
      ? { reminderAt: computeReminderAt(input.dueDate, await getUserTimeZone(userId)), notifiedAt: null }
      : {};

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { ...input, ...reminder },
    include: { category: true },
  });
  syncTaskSafe(task.id);
  return task;
}

export async function deleteTask(userId: string, taskId: string) {
  const task = await findOwnedTask(userId, taskId);
  await prisma.task.delete({ where: { id: taskId } });
  void removeTaskEvent(userId, task.googleEventId);
}
