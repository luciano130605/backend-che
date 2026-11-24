import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("../config/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique, update: mocks.update } },
}));
vi.mock("./email.service", () => ({ sendEmail: mocks.sendEmail }));

import { env } from "../config/env";
import {
  VerificationError,
  canonicalEmail,
  isDisposableEmail,
  sendVerificationCode,
  verifyEmailCode,
} from "./email-verification.service";

const NOW = new Date("2026-11-12T15:00:00Z");
const hash = (code: string) => crypto.createHmac("sha256", env.jwtSecret).update(code).digest("hex");

describe("canonicalEmail", () => {
  it("unifica alias y puntos de Gmail", () => {
    expect(canonicalEmail("Ni.Co+prueba@Gmail.com")).toBe("nico@gmail.com");
    expect(canonicalEmail("nico@googlemail.com")).toBe("nico@gmail.com");
  });

  it("en otros dominios saca el alias pero respeta los puntos", () => {
    expect(canonicalEmail("ana.perez+che@outlook.com")).toBe("ana.perez@outlook.com");
  });
});

describe("isDisposableEmail", () => {
  it("detecta casillas temporales conocidas", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@gmail.com")).toBe(false);
  });
});

describe("sendVerificationCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("guarda el código hasheado y lo manda por mail", async () => {
    mocks.findUnique.mockResolvedValue({ email: "nico@example.com", emailVerifiedAt: null, emailVerificationSentAt: null });

    await sendVerificationCode("user-1", NOW);

    const [to, subject] = mocks.sendEmail.mock.calls[0];
    const code = subject.slice(0, 6);
    expect(to).toBe("nico@example.com");
    expect(code).toMatch(/^\d{6}$/);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({ emailVerificationCodeHash: hash(code), emailVerificationAttempts: 0 }),
    });
  });

  it("no deja pedir otro código antes del minuto", async () => {
    mocks.findUnique.mockResolvedValue({
      email: "nico@example.com",
      emailVerifiedAt: null,
      emailVerificationSentAt: new Date(NOW.getTime() - 20_000),
    });

    await expect(sendVerificationCode("user-1", NOW)).rejects.toMatchObject<VerificationError>({ statusCode: 429 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("verifyEmailCode", () => {
  beforeEach(() => vi.clearAllMocks());

  const pending = (overrides = {}) => ({
    emailVerifiedAt: null,
    emailVerificationCodeHash: hash("123456"),
    emailVerificationExpiresAt: new Date(NOW.getTime() + 60_000),
    emailVerificationAttempts: 0,
    ...overrides,
  });

  it("verifica con el código correcto", async () => {
    mocks.findUnique.mockResolvedValue(pending());

    await verifyEmailCode("user-1", "123456", NOW);

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({ emailVerifiedAt: NOW, emailVerificationCodeHash: null }),
    });
  });

  it("suma un intento si el código es incorrecto", async () => {
    mocks.findUnique.mockResolvedValue(pending());

    await expect(verifyEmailCode("user-1", "000000", NOW)).rejects.toMatchObject<VerificationError>({ statusCode: 400 });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { emailVerificationAttempts: { increment: 1 } },
    });
  });

  it("rechaza códigos vencidos y cuentas con demasiados intentos", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(pending({ emailVerificationExpiresAt: new Date(NOW.getTime() - 1) }))
      .mockResolvedValueOnce(pending({ emailVerificationAttempts: 5 }));

    await expect(verifyEmailCode("user-1", "123456", NOW)).rejects.toMatchObject<VerificationError>({ statusCode: 410 });
    await expect(verifyEmailCode("user-1", "123456", NOW)).rejects.toMatchObject<VerificationError>({ statusCode: 429 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
