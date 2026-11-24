export const DEFAULT_TIME_ZONE = "America/Argentina/Buenos_Aires";

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const TIME_ZONE_SHAPE = /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)*$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function isValidTimeZone(timeZone: string) {
  if (!TIME_ZONE_SHAPE.test(timeZone)) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

export function localDate(date: Date, timeZone: string) {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function localTime(date: Date, timeZone: string) {
  const { hour, minute } = zonedParts(date, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

export function weekdayIndex(date: Date, timeZone: string) {
  const { year, month, day } = zonedParts(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function hasExplicitTime(date: Date, timeZone: string) {
  const { hour, minute } = zonedParts(date, timeZone);
  return hour !== 0 || minute !== 0;
}

// Diferencia en días de calendario (en la zona del usuario) entre dos instantes.
export function dayDiff(date: Date, now: Date, timeZone: string) {
  const a = zonedParts(date, timeZone);
  const b = zonedParts(now, timeZone);
  const diff = Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
  return Math.round(diff / 86_400_000);
}

export function minutesOfDay(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function describeNow(now: Date, timeZone: string) {
  return {
    date: localDate(now, timeZone),
    time: localTime(now, timeZone),
    weekday: WEEKDAYS[weekdayIndex(now, timeZone)],
  };
}

// Le damos al modelo el calendario ya resuelto: calcular de memoria qué día cae "el sábado" es donde más se equivoca.
export function buildCalendarHint(now: Date, timeZone: string, days = 14) {
  const { year, month, day } = zonedParts(now, timeZone);
  const lines: string[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(year, month - 1, day + i));
    const note = i === 0 ? " (hoy)" : i === 1 ? " (mañana)" : "";
    lines.push(`- ${WEEKDAYS[date.getUTCDay()]} ${date.toISOString().slice(0, 10)}${note}`);
  }

  return lines.join("\n");
}

// Convierte una hora "de reloj" en una zona (ej. 10:00 en Madrid) al instante UTC correspondiente.
function zonedTimeToUtc(parts: ZonedParts, timeZone: string) {
  const offsetAt = (timestamp: number) => {
    const p = zonedParts(new Date(timestamp), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(timestamp / 1000) * 1000;
  };

  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

// "2026-10-06" o "2026-10-06T10:30" se interpretan como hora de la zona del usuario.
export function parseDueDate(value: string | null | undefined, timeZone: string): Date | undefined {
  if (!value) return undefined;

  const text = value.trim();
  const dateOnly = DATE_ONLY.exec(text);
  const dateTime = DATE_TIME.exec(text);

  if (!dateOnly && !dateTime) {
    // Cualquier otro formato (por ejemplo, con "Z" o un offset explícito) se respeta tal cual.
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const match = (dateTime ?? dateOnly)!;
  const parts: ZonedParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: dateTime ? Number(match[4]) : 0,
    minute: dateTime ? Number(match[5]) : 0,
    second: dateTime ? Number(match[6] ?? 0) : 0,
  };

  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return undefined;

  const date = zonedTimeToUtc(parts, timeZone);

  // JavaScript corre el 31 de febrero al 3 de marzo; preferimos descartarlo.
  const expected = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  return localDate(date, timeZone) === expected ? date : undefined;
}