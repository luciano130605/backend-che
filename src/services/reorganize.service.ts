import { prisma } from "../config/prisma";
import { computeReminderAt } from "./task.service";
import { hasExplicitTime } from "./zoned-date";

// Duración que se asume para cada tarea con hora al buscar choques.
const SLOT_MINUTES = 60;
const SLOT_MS = SLOT_MINUTES * 60_000;
const MAX_SHIFTS = 24;

export interface ReorganizationNote {
  taskId: string;
  title: string;
  from: string;
  to: string | null; // null = hay choque pero no se movió (plan Gratis)
  conflictsWith: string;
}

// Tareas pendientes del usuario que pisan el horario [start, start + SLOT).
async function findOverlaps(userId: string, start: Date, excludeId?: string) {
  return prisma.task.findMany({
    where: {
      userId,
      status: "PENDING",
      id: excludeId ? { not: excludeId } : undefined,
      dueDate: {
        gt: new Date(start.getTime() - SLOT_MS),
        lt: new Date(start.getTime() + SLOT_MS),
      },
    },
    orderBy: { dueDate: "asc" },
    select: { title: true, dueDate: true },
  });
}

// Revisa si una tarea recién creada pisa a otra. En Pro la mueve al próximo
// hueco libre; en Gratis solo informa el choque, sin tocar nada.
export async function reorganizeNewTask(
  userId: string,
  task: { id: string; title: string; dueDate: Date | null },
  timeZone: string,
  canReorganize: boolean,
): Promise<ReorganizationNote | null> {
  if (!task.dueDate || !hasExplicitTime(task.dueDate, timeZone)) return null;

  const first = await findOverlaps(userId, task.dueDate, task.id);
  if (first.length === 0) return null;

  const note = {
    taskId: task.id,
    title: task.title,
    from: task.dueDate.toISOString(),
    conflictsWith: first[0].title,
  };
  if (!canReorganize) return { ...note, to: null };

  let candidate = task.dueDate;
  for (let i = 0; i < MAX_SHIFTS; i++) {
    const overlaps = await findOverlaps(userId, candidate, task.id);
    if (overlaps.length === 0) {
      await prisma.task.update({
        where: { id: task.id },
        data: {
          dueDate: candidate,
          reminderAt: computeReminderAt(candidate, timeZone),
          notifiedAt: null,
        },
      });
      return { ...note, to: candidate.toISOString() };
    }
    const lastEnd = Math.max(...overlaps.map((t) => t.dueDate!.getTime())) + SLOT_MS;
    candidate = new Date(lastEnd);
  }

  return { ...note, to: null };
}
