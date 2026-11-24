import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { hasExplicitTime, localDate } from "./zoned-date";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const EVENT_DURATION_MS = 30 * 60 * 1000;

export class CalendarError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "CalendarError";
  }
}

type SyncableTask = {
  title: string;
  rawText: string;
  dueDate: Date | null;
  status: "PENDING" | "DONE" | "DISMISSED";
  priority: "LOW" | "MEDIUM" | "HIGH";
};

const PRIORITY_LABEL = { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta" } as const;

function encryptionKey() {
  return createHash("sha256").update(env.tokenEncryptionKey ?? env.jwtSecret).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64")).join(".");
}

export function decryptToken(stored: string): string {
  const [iv, tag, data] = stored.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function createOAuthClient() {
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new CalendarError("La conexión con Google Calendar no está configurada.", 503);
  }
  return new OAuth2Client(env.googleClientId, env.googleClientSecret, env.googleCalendarRedirectUri);
}

/** Arma el body del evento. Una fecha sin hora (medianoche en la zona del usuario) es un evento de todo el día. */
export function buildEventBody(task: SyncableTask, timeZone: string) {
  const due = task.dueDate!;
  const description = [
    `Prioridad: ${PRIORITY_LABEL[task.priority]}`,
    task.rawText !== task.title ? `Texto original: ${task.rawText}` : null,
    "Creado desde Che.",
  ].filter(Boolean).join("\n");

  const day = localDate(due, timeZone);
  const [year, month, date] = day.split("-").map(Number);
  const times = hasExplicitTime(due, timeZone)
    ? {
        start: { dateTime: due.toISOString(), timeZone },
        end: { dateTime: new Date(due.getTime() + EVENT_DURATION_MS).toISOString(), timeZone },
      }
    : {
        start: { date: day },
        end: { date: new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10) },
      };

  return {
    summary: task.status === "DONE" ? `✅ ${task.title}` : task.title,
    description,
    ...times,
  };
}

export function buildAuthUrl(userId: string) {
  const state = jwt.sign({ userId, purpose: "calendar-connect" }, env.jwtSecret, { expiresIn: "10m" });
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [CALENDAR_SCOPE],
    state,
  });
}

export async function completeConnection(code: string, state: string) {
  let userId: string;
  try {
    const payload = jwt.verify(state, env.jwtSecret) as { userId: string; purpose?: string };
    if (payload.purpose !== "calendar-connect") throw new Error("purpose");
    userId = payload.userId;
  } catch {
    throw new CalendarError("El intento de conexión venció. Probá de nuevo.", 400);
  }

  const client = createOAuthClient();
  let refreshToken: string | null | undefined;
  try {
    ({ tokens: { refresh_token: refreshToken } } = await client.getToken(code));
  } catch {
    throw new CalendarError("Google rechazó el código de autorización.", 400);
  }
  if (!refreshToken) {
    throw new CalendarError("Google no devolvió permiso offline. Probá de nuevo.", 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { googleCalendarRefreshToken: encryptToken(refreshToken), googleCalendarConnectedAt: new Date() },
  });
  void syncAllTasksForUser(userId);
  return userId;
}

export async function getCalendarStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleCalendarRefreshToken: true },
  });
  return { connected: Boolean(user?.googleCalendarRefreshToken) };
}

export async function disconnectCalendar(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleCalendarRefreshToken: true },
  });
  if (user?.googleCalendarRefreshToken) {
    try {
      await createOAuthClient().revokeToken(decryptToken(user.googleCalendarRefreshToken));
    } catch {
      // si ya estaba revocado o Google no responde, igual desconectamos de nuestro lado
    }
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { googleCalendarRefreshToken: null, googleCalendarConnectedAt: null },
    }),
    prisma.task.updateMany({ where: { userId }, data: { googleEventId: null } }),
  ]);
}

function httpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}

function isRevokedGrant(error: unknown) {
  const data = (error as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error === "invalid_grant" || (error instanceof Error && error.message.includes("invalid_grant"));
}

/** Deja el evento de Google Calendar acorde al estado actual de la tarea. Idempotente. */
export async function syncTask(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { user: true } });
  if (!task || !task.user.googleCalendarRefreshToken) return;

  const client = createOAuthClient();
  client.setCredentials({ refresh_token: decryptToken(task.user.googleCalendarRefreshToken) });

  const shouldHaveEvent = Boolean(task.dueDate) && task.status !== "DISMISSED";

  try {
    if (!shouldHaveEvent) {
      if (task.googleEventId) {
        try {
          await client.request({ url: `${EVENTS_URL}/${task.googleEventId}`, method: "DELETE" });
        } catch (error) {
          if (httpStatus(error) !== 404 && httpStatus(error) !== 410) throw error;
        }
        await prisma.task.update({ where: { id: task.id }, data: { googleEventId: null } });
      }
      return;
    }

    const body = buildEventBody(task, task.user.timeZone);
    if (task.googleEventId) {
      try {
        await client.request({ url: `${EVENTS_URL}/${task.googleEventId}`, method: "PATCH", data: body });
        return;
      } catch (error) {
        // el usuario borró el evento a mano: lo recreamos
        if (httpStatus(error) !== 404 && httpStatus(error) !== 410) throw error;
      }
    }
    const created = await client.request<{ id: string }>({ url: EVENTS_URL, method: "POST", data: body });
    await prisma.task.update({ where: { id: task.id }, data: { googleEventId: created.data.id } });
  } catch (error) {
    if (isRevokedGrant(error)) {
      await prisma.user.update({
        where: { id: task.userId },
        data: { googleCalendarRefreshToken: null, googleCalendarConnectedAt: null },
      });
    }
    throw error;
  }
}

/** Para llamar desde los flujos de tareas: nunca debe romper la operación principal. */
export function syncTaskSafe(taskId: string) {
  syncTask(taskId).catch((error) => {
    console.error(`No se pudo sincronizar la tarea ${taskId} con Google Calendar:`, error instanceof Error ? error.message : error);
  });
}

async function syncAllTasksForUser(userId: string) {
  const tasks = await prisma.task.findMany({
    where: { userId, status: "PENDING", dueDate: { not: null }, googleEventId: null },
    select: { id: true },
  });
  for (const task of tasks) {
    try { await syncTask(task.id); }
    catch (error) { console.error(`Sync inicial falló para ${task.id}:`, error instanceof Error ? error.message : error); }
  }
}

/** Para borrar tareas: hay que quitar el evento antes de que desaparezca la fila. */
export async function removeTaskEvent(userId: string, googleEventId: string | null) {
  if (!googleEventId) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleCalendarRefreshToken: true },
  });
  if (!user?.googleCalendarRefreshToken) return;
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: decryptToken(user.googleCalendarRefreshToken) });
  try {
    await client.request({ url: `${EVENTS_URL}/${googleEventId}`, method: "DELETE" });
  } catch (error) {
    if (httpStatus(error) !== 404 && httpStatus(error) !== 410) {
      console.error("No se pudo borrar el evento de Google Calendar:", error instanceof Error ? error.message : error);
    }
  }
}
