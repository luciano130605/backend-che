import { createHash, randomBytes } from "crypto";
import TelegramBot from "node-telegram-bot-api";
import { NotificationActionType } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { sendTelegramMessage, TELEGRAM_HTML_OPTIONS } from "./telegram.service";
import { sendEmail } from "./email.service";
import { syncTaskSafe } from "./calendar.service";
import { buildSummaryForUser, getAppUrl, USER_NOTIFY_SELECT } from "./summary.service";
import { buildTaskReminderMessage, type BuiltMessage, type ReminderActions, type TemplateTask } from "./message.templates";
import { computeReminderAt } from "./task.service";
import { postponeToTomorrow } from "./due-date";
import { DEFAULT_TIME_ZONE, localDate, localTime, minutesOfDay } from "./zoned-date";

type Channel = "EMAIL" | "TELEGRAM";

interface NotifyUser {
  id: string;
  name: string | null;
  email: string;
  telegramChatId: string | null;
  notificationChannel: string;
  timeZone: string;
}

type ReminderTask = TemplateTask & { id: string };

// sent y failed cuentan envíos por canal: con "ambos" un resumen puede sumar 2 enviados.
export interface DispatchResult {
  sent: number;
  failed: number;
  failures: string[];
}

export interface DailySummaryResult extends DispatchResult {
  withoutTasks: number;
}

// Si el backend estaba apagado a la hora del resumen, todavía se manda hasta una hora después.
const SUMMARY_WINDOW_MINUTES = 60;

const SCHEDULE_SELECT = {
  ...USER_NOTIFY_SELECT,
  dailySummaryTime: true,
  lastSummaryOn: true,
} as const;

const REMINDER_USER_SELECT = {
  ...USER_NOTIFY_SELECT,
  quietHoursStart: true,
  quietHoursEnd: true,
} as const;

export const ACTION_LABEL: Record<NotificationActionType, string> = {
  DONE: "Marcada como hecha ✓",
  TOMORROW: "Pospuesta para mañana →",
  DISMISS: "Descartada ×",
};

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "error desconocido";
}

// "No molestar": solo frena los recordatorios puntuales; el resumen diario sale a la hora que eligió.
export function isInQuietHours(
  user: { quietHoursStart: string | null; quietHoursEnd: string | null; timeZone?: string },
  now = new Date(),
) {
  if (!user.quietHoursStart || !user.quietHoursEnd) return false;
  const minutes = minutesOfDay(localTime(now, user.timeZone ?? DEFAULT_TIME_ZONE));
  const start = minutesOfDay(user.quietHoursStart);
  const end = minutesOfDay(user.quietHoursEnd);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Por dónde sale un aviso. Si eligió Telegram pero todavía no lo vinculó, cae en email como respaldo. */
export function resolveChannels(user: Pick<NotifyUser, "notificationChannel" | "telegramChatId">): Channel[] {
  const wantsTelegram = user.notificationChannel === "TELEGRAM" || user.notificationChannel === "BOTH";
  const wantsEmail = user.notificationChannel === "EMAIL" || user.notificationChannel === "BOTH";
  const viaTelegram = wantsTelegram && Boolean(user.telegramChatId);
  const viaEmail = wantsEmail || !viaTelegram;
  return [...(viaTelegram ? ["TELEGRAM" as const] : []), ...(viaEmail ? ["EMAIL" as const] : [])];
}

/** Envía por cada canal y deja registro de cada intento en el historial de avisos. */
async function deliver(
  user: NotifyUser,
  message: BuiltMessage,
  options: { taskId?: string; telegramMarkup?: TelegramBot.InlineKeyboardMarkup } = {},
) {
  const channels = resolveChannels(user);
  const run = (channel: Channel) =>
    channel === "TELEGRAM"
      ? sendTelegramMessage(user.telegramChatId!, message.telegram, {
          ...TELEGRAM_HTML_OPTIONS,
          ...(options.telegramMarkup ? { reply_markup: options.telegramMarkup } : {}),
        })
      : sendEmail(user.email, message.subject, message.text, message.html);

  const settled = await Promise.allSettled(channels.map(run));

  const outcome = { sent: 0, failures: [] as string[] };
  await Promise.all(settled.map(async (result, index) => {
    const channel = channels[index];
    const error = result.status === "rejected" ? describeError(result.reason) : null;
    if (error) outcome.failures.push(`${channel === "TELEGRAM" ? "Telegram" : "Email"}: ${error}`);
    else outcome.sent++;
    await prisma.notificationLog.create({
      data: {
        userId: user.id, taskId: options.taskId, channel,
        status: error ? "FAILED" : "SENT", subject: message.subject, body: message.text, error,
      },
    }).catch((logError) => console.error("No se pudo registrar el aviso en el historial:", logError));
  }));
  return outcome;
}

// --- Acciones sobre la tarea (Hecho / Mañana / Descartar) ---

/** callback_data de Telegram: "task:<ACCION>:<taskId>" (entra en el límite de 64 bytes). */
export function taskActionKeyboard(taskId: string): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "✓ Hecho", callback_data: `task:DONE:${taskId}` },
      { text: "→ Mañana", callback_data: `task:TOMORROW:${taskId}` },
      { text: "× Descartar", callback_data: `task:DISMISS:${taskId}` },
    ]],
  };
}

export function parseTaskActionData(data: string): { action: NotificationActionType; taskId: string } | null {
  const match = /^task:(DONE|TOMORROW|DISMISS):([0-9a-f-]{36})$/.exec(data);
  return match ? { action: match[1] as NotificationActionType, taskId: match[2] } : null;
}

/** Aplica la acción e invalida los links de email que quedaban para esa tarea. */
export async function applyTaskAction(taskId: string, action: NotificationActionType) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { user: { select: { timeZone: true } } } });
  if (!task) throw new Error("La tarea ya no existe.");

  let data;
  if (action === "DONE") data = { status: "DONE" as const };
  else if (action === "DISMISS") data = { status: "DISMISSED" as const };
  else {
    const dueDate = postponeToTomorrow(task.dueDate, task.user.timeZone);
    data = { dueDate, reminderAt: computeReminderAt(dueDate, task.user.timeZone), notifiedAt: null };
  }

  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data }),
    prisma.notificationActionToken.updateMany({ where: { taskId, usedAt: null }, data: { usedAt: new Date() } }),
  ]);
  syncTaskSafe(taskId);
  return action;
}

export async function applyNotificationAction(rawToken: string) {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const token = await prisma.notificationActionToken.findUnique({ where: { tokenHash } });
  if (!token || token.usedAt || token.expiresAt < new Date()) throw new Error("Este enlace ya no es válido.");
  return applyTaskAction(token.taskId, token.action);
}

async function createActionUrl(taskId: string, action: NotificationActionType) {
  const token = randomBytes(32).toString("hex");
  await prisma.notificationActionToken.create({
    data: {
      taskId,
      action,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  return `${env.publicApiUrl}/api/notifications/action?token=${token}`;
}

async function createActionUrls(taskId: string): Promise<ReminderActions> {
  const [done, tomorrow, dismiss] = await Promise.all([
    createActionUrl(taskId, "DONE"),
    createActionUrl(taskId, "TOMORROW"),
    createActionUrl(taskId, "DISMISS"),
  ]);
  return { done, tomorrow, dismiss };
}

/** Recordatorio de una tarea: botones en Telegram, links de un solo uso en el email. */
async function sendTaskReminder(user: NotifyUser, task: ReminderTask, options: { test?: boolean } = {}) {
  const actions = resolveChannels(user).includes("EMAIL") ? await createActionUrls(task.id) : undefined;
  const message = buildTaskReminderMessage({ name: user.name, task, timeZone: user.timeZone, appUrl: getAppUrl(), actions });
  if (options.test) message.subject = `[Prueba] ${message.subject}`;
  return deliver(user, message, { taskId: task.id, telegramMarkup: taskActionKeyboard(task.id) });
}

// --- Resumen diario ---

// Envío manual (endpoint de pruebas y "Enviar ahora"): ignora la hora configurada.
export async function sendDailySummaries(options: { onlyUserId?: string } = {}): Promise<DailySummaryResult> {
  const result: DailySummaryResult = { sent: 0, withoutTasks: 0, failed: 0, failures: [] };

  const users = await prisma.user.findMany({
    where: options.onlyUserId ? { id: options.onlyUserId } : undefined,
    select: USER_NOTIFY_SELECT,
  });

  for (const user of users) {
    try {
      const { message, taskCount } = await buildSummaryForUser(user);

      if (taskCount === 0) {
        result.withoutTasks++;
        continue;
      }

      const outcome = await deliver(user, message);
      result.sent += outcome.sent;
      result.failed += outcome.failures.length;
      result.failures.push(...outcome.failures);
      outcome.failures.forEach((failure) => console.error(`Resumen a ${user.id} — ${failure}`));
    } catch (error) {
      result.failed++;
      result.failures.push(describeError(error));
      console.error(`No se pudo armar el resumen de ${user.id}:`, error);
    }
  }

  return result;
}

// Se ejecuta cada minuto: manda el resumen a quienes ya llegaron a SU hora, en SU zona horaria.
export async function sendDueDailySummaries(now = new Date()): Promise<DailySummaryResult> {
  const result: DailySummaryResult = { sent: 0, withoutTasks: 0, failed: 0, failures: [] };

  const users = await prisma.user.findMany({ select: SCHEDULE_SELECT });

  for (const user of users) {
    let claimed = false;

    try {
      const today = localDate(now, user.timeZone);
      if (user.lastSummaryOn === today) continue;

      const minutesPast = minutesOfDay(localTime(now, user.timeZone)) - minutesOfDay(user.dailySummaryTime);
      if (minutesPast < 0 || minutesPast >= SUMMARY_WINDOW_MINUTES) continue;

      // Reservamos el día antes de enviar: si dos pasadas se solapan, solo una lo manda.
      const reservation = await prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [{ lastSummaryOn: null }, { lastSummaryOn: { not: today } }],
        },
        data: { lastSummaryOn: today },
      });
      if (reservation.count !== 1) continue;
      claimed = true;

      const { message, taskCount } = await buildSummaryForUser(user);

      if (taskCount === 0) {
        result.withoutTasks++;
        continue;
      }

      const outcome = await deliver(user, message);
      result.sent += outcome.sent;
      result.failed += outcome.failures.length;
      result.failures.push(...outcome.failures);
      outcome.failures.forEach((failure) => console.error(`Resumen a ${user.id} — ${failure}`));

      // Si no salió por ningún canal, se libera el día para reintentar en la próxima pasada.
      if (outcome.sent === 0) {
        await prisma.user.updateMany({ where: { id: user.id }, data: { lastSummaryOn: user.lastSummaryOn } });
      }
    } catch (error) {
      result.failed++;
      result.failures.push(describeError(error));
      console.error(`No se pudo mandar el resumen de ${user.id}:`, error);

      if (claimed) {
        await prisma.user.updateMany({ where: { id: user.id }, data: { lastSummaryOn: user.lastSummaryOn } });
      }
    }
  }

  return result;
}

// --- Recordatorios puntuales ---

// Recordatorios puntuales exclusivos de plan PAID: es el diferencial frente
// al resumen diario, que llega a todos los usuarios sin importar el plan.
export async function sendPendingReminders(): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, failed: 0, failures: [] };
  const now = new Date();

  const dueReminders = await prisma.task.findMany({
    where: {
      reminderAt: { lte: now },
      dueDate: { gt: now },
      notifiedAt: null,
      status: "PENDING",
      user: { plan: "PAID" },
    },
    include: {
      category: true,
      user: { select: REMINDER_USER_SELECT },
    },
  });

  for (const task of dueReminders) {
    // En horario de "no molestar" se deja pendiente: sale en la primera pasada después.
    if (isInQuietHours(task.user, now)) continue;

    try {
      const outcome = await sendTaskReminder(task.user, task);
      result.sent += outcome.sent;
      result.failed += outcome.failures.length;
      result.failures.push(...outcome.failures);
      outcome.failures.forEach((failure) => console.error(`Recordatorio de ${task.id} — ${failure}`));

      // Se marca como avisada si salió por al menos un canal; si no, se reintenta en la próxima pasada.
      if (outcome.sent > 0) {
        await prisma.task.update({
          where: { id: task.id },
          data: { notifiedAt: now },
        });
      }
    } catch (error) {
      result.failed++;
      result.failures.push(describeError(error));
      console.error(`No se pudo mandar el recordatorio de la tarea ${task.id}:`, error);
    }
  }

  return result;
}

// --- Preview y pruebas desde la app ---

async function topPendingTask(userId: string) {
  return prisma.task.findFirst({
    where: { userId, status: "PENDING" },
    orderBy: [{ priority: "desc" }, { dueDate: { sort: "asc", nulls: "last" } }],
    include: { category: true },
  });
}

/** Lo que se mandaría ahora: resumen diario, un recordatorio de ejemplo y por qué canales. */
export async function buildNotificationPreview(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: USER_NOTIFY_SELECT });
  if (!user) throw new Error("Usuario no encontrado.");

  const [{ message: summary }, sample] = await Promise.all([buildSummaryForUser(user), topPendingTask(userId)]);
  const channels = resolveChannels(user);
  const reminder = sample
    ? buildTaskReminderMessage({ name: user.name, task: sample, timeZone: user.timeZone, appUrl: getAppUrl() }).text
    : null;

  return {
    channels,
    // Eligió Telegram (o ambos) pero no lo vinculó: va solo por email.
    channelFallback: user.notificationChannel !== "EMAIL" && !channels.includes("TELEGRAM"),
    summary: summary.text,
    reminder: reminder
      ? `${reminder}\n\n${channels.includes("TELEGRAM") ? "Telegram: [✓ Hecho] [→ Mañana] [× Descartar]" : ""}${channels.length === 2 ? "\n" : ""}${channels.includes("EMAIL") ? "Email: links ✓ Hecho · → Mañana · × Ya no me interesa" : ""}`
      : null,
  };
}

/** "Probar recordatorio": manda uno real de la tarea más urgente, ignorando plan y "no molestar". */
export async function sendTestReminder(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: USER_NOTIFY_SELECT });
  if (!user) throw new Error("Usuario no encontrado.");
  const task = await topPendingTask(userId);
  if (!task) return { taskTitle: null, sent: 0, failures: [] as string[] };
  const outcome = await sendTaskReminder(user, task, { test: true });
  return { taskTitle: task.title, ...outcome };
}
