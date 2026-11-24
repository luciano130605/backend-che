import { describe, expect, it, vi } from "vitest";

vi.mock("node-telegram-bot-api", () => ({ default: vi.fn() }));
vi.mock("../config/prisma", () => ({ prisma: {} }));
vi.mock("../config/env", () => ({ env: { telegramBotToken: "x", telegramPolling: false } }));
vi.mock("./summary.service", () => ({ buildSummaryForUser: vi.fn() }));

import { isSummaryRequest } from "./telegram.service";

describe("isSummaryRequest", () => {
  it("reconoce pedidos de resumen", () => {
    for (const text of ["che, qué tenemos para hoy", "¿Qué tengo mañana?", "que hay hoy", "resumen", "Hoy", "che pendientes?"]) {
      expect(isSummaryRequest(text), text).toBe(true);
    }
  });

  it("no confunde una tarea que menciona 'hoy' con un pedido de resumen", () => {
    for (const text of ["pagar el ABL hoy", "hoy llamar a Flor", "tengo que ver la agenda del médico", "comprar pendientes para mamá"]) {
      expect(isSummaryRequest(text), text).toBe(false);
    }
  });
});
