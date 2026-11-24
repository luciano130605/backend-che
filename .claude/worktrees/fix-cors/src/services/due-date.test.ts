import { describe, expect, it } from "vitest";
import { formatDueDate, postponeToTomorrow } from "./due-date";
import { parseDueDate } from "./zoned-date";

const AR = "America/Argentina/Buenos_Aires";
const MADRID = "Europe/Madrid";

describe("formatDueDate", () => {
  it("muestra solo el día si no tiene hora", () => {
    expect(formatDueDate(parseDueDate("2026-10-20", AR)!, AR)).toBe("mar 20/10");
  });

  it("muestra la hora en la zona del usuario", () => {
    expect(formatDueDate(parseDueDate("2026-10-20T10:00", AR)!, AR)).toBe("mar 20/10 10:00");
    expect(formatDueDate(parseDueDate("2026-10-20T23:30", MADRID)!, MADRID)).toBe("mar 20/10 23:30");
  });

  it("sin fecha", () => {
    expect(formatDueDate(null, AR)).toBe("sin fecha");
  });
});

describe("postponeToTomorrow", () => {
  const now = new Date("2026-10-20T15:00:00Z"); // 12:00 en Argentina

  it("mueve una fecha sin hora al día siguiente, sin inventar hora", () => {
    const result = postponeToTomorrow(parseDueDate("2026-10-20", AR)!, AR, now)!;
    expect(result.toISOString()).toBe(parseDueDate("2026-10-21", AR)!.toISOString());
  });

  it("mantiene la hora y lleva a mañana aunque la tarea estuviera vencida", () => {
    const result = postponeToTomorrow(parseDueDate("2026-10-15T18:30", AR)!, AR, now)!;
    expect(result.toISOString()).toBe("2026-10-21T21:30:00.000Z");
  });

  it("usa el día de mañana del usuario, no el de UTC", () => {
    const lateNight = new Date("2026-10-21T02:00:00Z"); // 23:00 del 20 en Argentina
    const result = postponeToTomorrow(parseDueDate("2026-10-20T09:00", AR)!, AR, lateNight)!;
    expect(result.toISOString()).toBe("2026-10-21T12:00:00.000Z");
  });

  it("sin fecha sigue sin fecha", () => {
    expect(postponeToTomorrow(null, AR, now)).toBeNull();
  });
});
