// Helpers de fechas de tareas que se apoyan en zoned-date (convención: una fecha sin hora es la
// medianoche de ese día en la zona horaria del usuario).
import { hasExplicitTime, localDate, localTime, parseDueDate, weekdayIndex, zonedParts } from "./zoned-date";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "mar 20/10" o "mar 20/10 10:00" en la zona del usuario. */
export function formatDueDate(date: Date | null, timeZone: string): string {
  if (!date) return "sin fecha";
  const { day, month } = zonedParts(date, timeZone);
  const label = `${WEEKDAYS[weekdayIndex(date, timeZone)]} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  return hasExplicitTime(date, timeZone) ? `${label} ${localTime(date, timeZone)}` : label;
}

/**
 * "Mañana" desde un recordatorio: la tarea pasa al día siguiente (en la zona del usuario),
 * manteniendo la hora si tenía. Sin fecha, sigue sin fecha.
 */
export function postponeToTomorrow(dueDate: Date | null, timeZone: string, now = new Date()): Date | null {
  if (!dueDate) return null;
  const tomorrow = localDate(new Date(now.getTime() + DAY_MS), timeZone);
  const value = hasExplicitTime(dueDate, timeZone) ? `${tomorrow}T${localTime(dueDate, timeZone)}` : tomorrow;
  return parseDueDate(value, timeZone) ?? null;
}
