import { prisma } from "../config/prisma";
import { localDate } from "./zoned-date";

// Límites mensuales de mensajes por plan. null = sin límite.
// Cuando el plan pago se divida en Plus (50) y Pro (sin límite), se ajusta acá.
const MESSAGE_LIMITS: Record<string, number | null> = {
  FREE: 20,
  PAID: 50,
};

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

  return {
    used: user.usagePeriod === period ? user.messagesUsed : 0,
    limit: MESSAGE_LIMITS[user.plan] ?? null,
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
