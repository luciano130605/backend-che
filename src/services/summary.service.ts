import { listTasks } from "./task.service";
import { buildDailySummaryMessage, type BuiltMessage } from "./message.templates";

export interface SummaryUser {
  id: string;
  name: string | null;
  timeZone: string;
}

// Solo lo necesario para notificar: así nunca se carga passwordHash ni otros campos sensibles.
export const USER_NOTIFY_SELECT = {
  id: true,
  name: true,
  email: true,
  telegramChatId: true,
  notificationChannel: true,
  timeZone: true,
} as const;

export function getAppUrl(): string | undefined {
  const base = process.env.FRONTEND_URL?.trim();
  return base ? `${base.replace(/\/+$/, "")}/app` : undefined;
}

export async function buildSummaryForUser(
  user: SummaryUser,
): Promise<{ message: BuiltMessage; taskCount: number }> {
  const tasks = await listTasks(user.id, { status: "PENDING", upcoming: true });
  const message = buildDailySummaryMessage({
    name: user.name,
    tasks,
    timeZone: user.timeZone,
    appUrl: getAppUrl(),
  });
  return { message, taskCount: tasks.length };
}
