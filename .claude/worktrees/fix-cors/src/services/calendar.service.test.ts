import { describe, expect, it, vi } from "vitest";

vi.mock("../config/prisma", () => ({ prisma: {} }));
vi.mock("../config/env", () => ({ env: { jwtSecret: "test-secret" } }));

import { buildEventBody, decryptToken, encryptToken } from "./calendar.service";
import { parseDueDate } from "./zoned-date";

const AR = "America/Argentina/Buenos_Aires";
const day = (value: string) => parseDueDate(value, AR)!;

const base = { title: "Pagar el alquiler", rawText: "Pagar el alquiler", status: "PENDING", priority: "HIGH" } as const;

describe("buildEventBody", () => {
  it("crea un evento de todo el día cuando la fecha no trae hora", () => {
    const body = buildEventBody({ ...base, dueDate: day("2026-10-20") }, AR);
    expect(body.start).toEqual({ date: "2026-10-20" });
    expect(body.end).toEqual({ date: "2026-10-21" });
  });

  it("crea un evento de 30 minutos cuando hay hora", () => {
    const body = buildEventBody({ ...base, dueDate: day("2026-10-20T10:00") }, AR);
    expect(body.start).toEqual({ dateTime: "2026-10-20T13:00:00.000Z", timeZone: AR });
    expect(body.end).toMatchObject({ dateTime: "2026-10-20T13:30:00.000Z" });
  });

  it("marca como hecha la tarea completada", () => {
    const body = buildEventBody({ ...base, status: "DONE", dueDate: day("2026-10-20") }, AR);
    expect(body.summary).toBe("✅ Pagar el alquiler");
  });

  it("incluye el texto original solo si difiere del título", () => {
    const body = buildEventBody({ ...base, rawText: "tengo que pagar el alquiler el martes", dueDate: day("2026-10-20") }, AR);
    expect(body.description).toContain("Texto original: tengo que pagar el alquiler el martes");
  });
});

describe("buildEventBody en otra zona horaria", () => {
  it("el día del evento es el del usuario, no el de UTC", () => {
    const madrid = "Europe/Madrid";
    const body = buildEventBody({ ...base, dueDate: parseDueDate("2026-10-31", madrid)! }, madrid);
    expect(body.start).toEqual({ date: "2026-10-31" });
    expect(body.end).toEqual({ date: "2026-11-01" });
  });
});

describe("cifrado del refresh token", () => {
  it("ida y vuelta devuelve el token original", () => {
    const stored = encryptToken("1//refresh-token");
    expect(stored).not.toContain("refresh-token");
    expect(decryptToken(stored)).toBe("1//refresh-token");
  });

  it("falla si el dato fue alterado", () => {
    const [iv, tag, data] = encryptToken("1//refresh-token").split(".");
    const tampered = [iv, tag, Buffer.from("otro").toString("base64")].join(".");
    expect(() => decryptToken(tampered)).toThrow();
    expect(data).toBeTruthy();
  });
});
