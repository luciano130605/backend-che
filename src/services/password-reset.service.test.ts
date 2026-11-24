import bcrypt from "bcryptjs";
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
import { PasswordResetError, requestPasswordReset, resetPassword } from "./password-reset.service";

const NOW = new Date("2026-11-14T15:00:00Z");
const hash = (code: string) => crypto.createHmac("sha256", env.jwtSecret).update(code).digest("hex");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
});

describe("requestPasswordReset", () => {
  it("manda un código de 6 números y guarda solo su hash", async () => {
    mocks.findUnique.mockResolvedValue({ id: "u1", email: "ana@mail.com", passwordResetSentAt: null });

    await requestPasswordReset("ana@mail.com", NOW);

    const [to, subject, text] = mocks.sendEmail.mock.calls[0];
    const code = /\b(\d{6})\b/.exec(text)?.[1];
    expect(to).toBe("ana@mail.com");
    expect(subject).toContain(code);
    const data = mocks.update.mock.calls[0][0].data;
    expect(data.passwordResetCodeHash).toBe(hash(code!));
    expect(data.passwordResetExpiresAt).toEqual(new Date(NOW.getTime() + 15 * 60_000));
  });

  it("no hace nada (ni avisa) si el email no tiene cuenta", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(requestPasswordReset("nadie@mail.com", NOW)).resolves.toBeUndefined();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("respeta el mínimo de un minuto entre envíos", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "u1",
      email: "ana@mail.com",
      passwordResetSentAt: new Date(NOW.getTime() - 30_000),
    });
    await requestPasswordReset("ana@mail.com", NOW);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("resetPassword", () => {
  const userWithCode = (overrides = {}) => ({
    id: "u1",
    emailVerifiedAt: NOW,
    passwordResetCodeHash: hash("123456"),
    passwordResetExpiresAt: new Date(NOW.getTime() + 60_000),
    passwordResetAttempts: 0,
    ...overrides,
  });

  it("cambia la contraseña con el código correcto y lo invalida", async () => {
    mocks.findUnique.mockResolvedValue(userWithCode());

    await resetPassword("ana@mail.com", "123456", "nueva-clave-1", NOW);

    const data = mocks.update.mock.calls[0][0].data;
    expect(await bcrypt.compare("nueva-clave-1", data.passwordHash)).toBe(true);
    expect(data.passwordResetCodeHash).toBeNull();
    expect(data.emailVerifiedAt).toBeUndefined();
  });

  it("verifica el email de quien todavía no lo había hecho", async () => {
    mocks.findUnique.mockResolvedValue(userWithCode({ emailVerifiedAt: null }));
    await resetPassword("ana@mail.com", "123456", "nueva-clave-1", NOW);
    expect(mocks.update.mock.calls[0][0].data.emailVerifiedAt).toEqual(NOW);
  });

  it("rechaza un código incorrecto y cuenta el intento", async () => {
    mocks.findUnique.mockResolvedValue(userWithCode());
    await expect(resetPassword("ana@mail.com", "000000", "nueva-clave-1", NOW)).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.update.mock.calls[0][0].data).toEqual({ passwordResetAttempts: { increment: 1 } });
  });

  it("rechaza un código vencido o inexistente", async () => {
    mocks.findUnique.mockResolvedValue(userWithCode({ passwordResetExpiresAt: new Date(NOW.getTime() - 1) }));
    await expect(resetPassword("ana@mail.com", "123456", "nueva-clave-1", NOW)).rejects.toBeInstanceOf(PasswordResetError);

    mocks.findUnique.mockResolvedValue(null);
    await expect(resetPassword("nadie@mail.com", "123456", "nueva-clave-1", NOW)).rejects.toMatchObject({ statusCode: 410 });
  });

  it("bloquea tras demasiados intentos, aunque el código sea el correcto", async () => {
    mocks.findUnique.mockResolvedValue(userWithCode({ passwordResetAttempts: 5 }));
    await expect(resetPassword("ana@mail.com", "123456", "nueva-clave-1", NOW)).rejects.toMatchObject({ statusCode: 429 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
