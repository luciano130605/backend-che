import { describe, expect, it, vi } from "vitest";

vi.mock("../config/prisma", () => ({ prisma: {} }));
vi.mock("../config/env", () => ({ env: { publicApiUrl: "http://localhost:3000" } }));
vi.mock("./telegram.service", () => ({ sendTelegramMessage: vi.fn(), TELEGRAM_HTML_OPTIONS: {} }));
vi.mock("./email.service", () => ({ sendEmail: vi.fn() }));

import { isInQuietHours, parseTaskActionData, resolveChannels, taskActionKeyboard } from "./reminder.service";

describe("quiet hours", () => {
  const settings = { quietHoursStart: "23:00", quietHoursEnd: "07:30" };

  it("detecta un horario nocturno que cruza medianoche", () => {
    expect(isInQuietHours(settings, new Date("2026-10-01T06:00:00Z"))).toBe(true); // 03:00 AR
    expect(isInQuietHours(settings, new Date("2026-10-01T15:00:00Z"))).toBe(false); // 12:00 AR
  });

  it("usa la zona horaria del usuario", () => {
    // 06:00 UTC = 03:00 en Argentina (silencio) pero 08:00 en Madrid (no)
    expect(isInQuietHours({ ...settings, timeZone: "Europe/Madrid" }, new Date("2026-10-01T06:00:00Z"))).toBe(false);
  });

  it("no bloquea cuando la preferencia está incompleta", () => {
    expect(isInQuietHours({ quietHoursStart: null, quietHoursEnd: null })).toBe(false);
  });
});

describe("acciones desde Telegram", () => {
  const taskId = "3f2b8c1e-9a4d-4e2f-8b1a-2c3d4e5f6a7b";

  it("los botones entran en el límite de 64 bytes y se pueden leer de vuelta", () => {
    const buttons = taskActionKeyboard(taskId).inline_keyboard[0];
    for (const button of buttons) {
      expect(Buffer.byteLength(button.callback_data!)).toBeLessThanOrEqual(64);
      expect(parseTaskActionData(button.callback_data!)?.taskId).toBe(taskId);
    }
  });

  it("rechaza datos que no son una acción válida", () => {
    expect(parseTaskActionData(`task:DELETE:${taskId}`)).toBeNull();
    expect(parseTaskActionData("int:ok:algo")).toBeNull();
  });
});

describe("canal de entrega", () => {
  it("cae a email si eligió Telegram pero no lo vinculó", () => {
    expect(resolveChannels({ notificationChannel: "TELEGRAM", telegramChatId: null })).toEqual(["EMAIL"]);
    expect(resolveChannels({ notificationChannel: "TELEGRAM", telegramChatId: "123" })).toEqual(["TELEGRAM"]);
  });

  it("con ambos manda por los dos, o solo email si falta vincular", () => {
    expect(resolveChannels({ notificationChannel: "BOTH", telegramChatId: "123" })).toEqual(["TELEGRAM", "EMAIL"]);
    expect(resolveChannels({ notificationChannel: "BOTH", telegramChatId: null })).toEqual(["EMAIL"]);
  });
});
