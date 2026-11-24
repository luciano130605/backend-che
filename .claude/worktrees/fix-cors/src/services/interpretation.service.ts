import { prisma } from "../config/prisma";
import { ParsedTaskItem } from "../types/bedrock.types";
import { BedrockError, parseTasksFromText } from "./bedrock.service";
import { syncTaskSafe } from "./calendar.service";
import { isEmailVerified } from "./email-verification.service";
import { computeReminderAt } from "./task.service";
import { registerMessageUsage } from "./usage.service";
import { DEFAULT_TIME_ZONE, parseDueDate } from "./zoned-date";

export class InterpretationError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "InterpretationError";
  }
}

export type InterpretationResult =
  | { interpretationId: string; status: "PENDING"; tasks: ParsedTaskItem[] }
  | { interpretationId: string; status: "FAILED"; message: string };

export const UNVERIFIED_MESSAGE = "Verificá tu email para usar la IA: te mandamos un código al registrarte.";

const UNPARSED_MESSAGE = "No pude interpretarlo, pero lo guardé en \"Sin interpretar\" para que no lo pierdas.";

async function getUserTimeZone(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  return user?.timeZone ?? DEFAULT_TIME_ZONE;
}

/** Interpreta un texto. Si Bedrock falla, el texto queda guardado como FAILED ("Sin interpretar"). */
export async function interpretText(userId: string, rawText: string): Promise<InterpretationResult> {
  // Sin email verificado no hay IA: así crear cuentas nuevas no renueva el plan gratis.
  if (!(await isEmailVerified(userId))) throw new InterpretationError(UNVERIFIED_MESSAGE, 403);
  // Cada mensaje interpretado cuenta para el límite mensual del plan, venga de la web o de Telegram.
  await registerMessageUsage(userId);
  try {
    const tasks = await parseTasksFromText(rawText, await getUserTimeZone(userId));
    const interpretation = await prisma.interpretation.create({
      data: { userId, originalText: rawText, parsedTasks: JSON.parse(JSON.stringify(tasks)) },
    });
    return { interpretationId: interpretation.id, status: "PENDING", tasks };
  } catch (error) {
    if (!(error instanceof BedrockError)) throw error;
    const interpretation = await prisma.interpretation.create({
      data: { userId, originalText: rawText, status: "FAILED", error: error.message },
    });
    return { interpretationId: interpretation.id, status: "FAILED", message: UNPARSED_MESSAGE };
  }
}

async function resolveCategoryId(categoryName: string | null): Promise<string | undefined> {
  if (!categoryName) return undefined;
  const category = await prisma.category.findUnique({ where: { name: categoryName } });
  return category?.id;
}

async function findOwned(userId: string, interpretationId: string, status: "PENDING" | "FAILED") {
  const interpretation = await prisma.interpretation.findFirst({ where: { id: interpretationId, userId, status } });
  if (!interpretation) {
    throw new InterpretationError(
      status === "PENDING" ? "Interpretación no encontrada o ya confirmada." : "Texto sin interpretar no encontrado.",
      404,
    );
  }
  return interpretation;
}

/** Guarda las tareas (posiblemente corregidas por el usuario). Sin `tasks`, usa lo que interpretó la IA. */
export async function confirmInterpretation(userId: string, interpretationId: string, tasks?: ParsedTaskItem[]) {
  const interpretation = await findOwned(userId, interpretationId, "PENDING");
  const items = tasks ?? (interpretation.parsedTasks as unknown as ParsedTaskItem[] | null) ?? [];
  if (items.length === 0) throw new InterpretationError("No hay tareas para guardar.");

  const timeZone = await getUserTimeZone(userId);
  const createdTasks = [];
  for (const item of items) {
    const dueDate = parseDueDate(item.dueDate, timeZone) ?? null;
    createdTasks.push(await prisma.task.create({
      data: {
        userId,
        interpretationId,
        rawText: interpretation.originalText,
        title: item.title,
        categoryId: await resolveCategoryId(item.categoryName),
        dueDate,
        reminderAt: computeReminderAt(dueDate, timeZone),
        priority: item.priority,
      },
      include: { category: true },
    }));
  }
  await prisma.interpretation.update({
    where: { id: interpretationId },
    data: { status: "CONFIRMED", confirmedAt: new Date(), parsedTasks: JSON.parse(JSON.stringify(items)) },
  });
  createdTasks.forEach((task) => syncTaskSafe(task.id));
  return createdTasks;
}

/** Descarta una interpretación pendiente (el usuario dijo que estaba mal). */
export async function discardPendingInterpretation(userId: string, interpretationId: string) {
  await findOwned(userId, interpretationId, "PENDING");
  await prisma.interpretation.delete({ where: { id: interpretationId } });
}

export function listUnparsed(userId: string) {
  return prisma.interpretation.findMany({
    where: { userId, status: "FAILED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, originalText: true, error: true, createdAt: true },
  });
}

/** Reintenta con Bedrock. Si sale bien, la interpretación pasa a PENDING y se devuelve para confirmar. */
export async function retryUnparsed(userId: string, interpretationId: string): Promise<InterpretationResult> {
  const interpretation = await findOwned(userId, interpretationId, "FAILED");
  try {
    const tasks = await parseTasksFromText(interpretation.originalText, await getUserTimeZone(userId));
    await prisma.interpretation.update({
      where: { id: interpretationId },
      data: { status: "PENDING", error: null, parsedTasks: JSON.parse(JSON.stringify(tasks)) },
    });
    return { interpretationId, status: "PENDING", tasks };
  } catch (error) {
    if (!(error instanceof BedrockError)) throw error;
    await prisma.interpretation.update({ where: { id: interpretationId }, data: { error: error.message } });
    return { interpretationId, status: "FAILED", message: "Sigue sin poder interpretarse. Podés guardarlo como tarea tal cual." };
  }
}

/** Guarda el texto tal cual como una tarea sin fecha. */
export async function saveUnparsedAsTask(userId: string, interpretationId: string) {
  const interpretation = await findOwned(userId, interpretationId, "FAILED");
  const title = interpretation.originalText.trim().replace(/\s+/g, " ");
  const task = await prisma.task.create({
    data: {
      userId,
      interpretationId,
      rawText: interpretation.originalText,
      title: title.length > 160 ? `${title.slice(0, 157)}…` : title,
    },
    include: { category: true },
  });
  await prisma.interpretation.update({
    where: { id: interpretationId },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });
  return task;
}

export async function deleteUnparsed(userId: string, interpretationId: string) {
  await findOwned(userId, interpretationId, "FAILED");
  await prisma.interpretation.delete({ where: { id: interpretationId } });
}
