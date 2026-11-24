import { prisma } from "../config/prisma";
import { localDate } from "./zoned-date";

// Límites mensuales de mensajes por plan. null = sin límite.
// FREE = Gratis (50), PAID = Che Pro (sin límite).
const MESSAGE_LIMITS: Record<string, number | null> = {
  FREE: 50,
  PAID: null,
};

// A partir de este porcentaje del cupo se avisa al usuario.
const WARNING_RATIO = 0.8;

export class PlanLimitError extends Error {
  constructor(
    message: string,
    public code: "MESSAGE_LIMIT_REACHED" | "REORGANIZATION_NOT_AVAILABLE",
    public statusCode: number = 429,
  ) {
    super(message);
    this.name = "PlanLimitError";
  }
}

interface UsageUser {
  plan: string;
  messagesUsed: number;
  usagePeriod: string | null;
  timeZone: string;
}

const periodOf = (now: Date, timeZone: string) => localDate(now, timeZone).slice(0, 7);

export function describeUsage(user: UsageUser, now = new Date()) {
  const period = periodOf(now, user.timeZone);
  const [year, month] = period.split("-").map(Number);

  const used = user.usagePeriod === period ? user.messagesUsed : 0;
  const limit = MESSAGE_LIMITS[user.plan] ?? null;

  return {
    used,
    limit,
    nearLimit: limit !== null && used >= Math.ceil(limit * WARNING_RATIO) && used < limit,
    blocked: limit !== null && used >= limit,
    // Primer día del mes siguiente (month ya es 1-based, así que Date.UTC(year, month, 1) es el mes que viene).
    resetsOn: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
  };
}

export async function registerMessageUsage(userId: string, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { usagePeriod: true, timeZone: true },
  });
  if (!user) return;

  const period = periodOf(now, user.timeZone);

  await prisma.user.update({
    where: { id: userId },
    data:
      user.usagePeriod === period
        ? { messagesUsed: { increment: 1 } }
        : { messagesUsed: 1, usagePeriod: period },
  });
}

// Se llama antes de gastar una llamada a la IA: corta con 429 si el cupo del mes se agotó.
export async function assertWithinMessageLimit(userId: string, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, messagesUsed: true, usagePeriod: true, timeZone: true },
  });
  if (!user) return;

  const usage = describeUsage(user, now);
  if (usage.blocked) {
    throw new PlanLimitError(
      `Llegaste al límite de ${usage.limit} mensajes de tu plan este mes. Pasate a Che Pro para tener mensajes ilimitados, o esperá al ${usage.resetsOn} que se renueva tu cupo.`,
      "MESSAGE_LIMIT_REACHED",
    );
  }
}
