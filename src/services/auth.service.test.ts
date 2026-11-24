import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  verifyIdToken: vi.fn(),
  sendVerificationCode: vi.fn(),
}));

vi.mock("../config/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      create: mocks.create,
    },
  },
}));

vi.mock("./email-verification.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email-verification.service")>()),
  sendVerificationCode: mocks.sendVerificationCode,
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = mocks.verifyIdToken;
  },
}));

import {
  AuthError,
  getAuthenticatedUser,
  loginUser,
  loginWithGoogle,
  registerUser,
} from "./auth.service";

const baseUser = {
  id: "user-1",
  email: "nico@example.com",
  name: "Nico",
  passwordHash: "hash",
  emailVerifiedAt: null,
};

describe("auth service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registra un usuario y nunca devuelve el hash", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue(baseUser);
    mocks.sendVerificationCode.mockResolvedValue(undefined);

    const result = await registerUser({
      email: baseUser.email,
      password: "password-segura",
      name: baseUser.name,
    });

    expect(result.user).toEqual({ id: baseUser.id, email: baseUser.email, name: baseUser.name, emailVerified: false });
    expect(mocks.sendVerificationCode).toHaveBeenCalledWith(baseUser.id);
    expect(result).not.toHaveProperty("passwordHash");
    expect(result.token).toEqual(expect.any(String));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: baseUser.email, name: baseUser.name }),
    }));
  });

  it("rechaza un email ya registrado", async () => {
    mocks.findFirst.mockResolvedValue({ id: baseUser.id });

    await expect(registerUser({ email: baseUser.email, password: "password-segura" }))
      .rejects.toMatchObject<AuthError>({ statusCode: 409 });
  });

  it("busca la misma casilla aunque venga con alias de Gmail", async () => {
    mocks.findFirst.mockResolvedValue({ id: baseUser.id });

    await expect(registerUser({ email: "Ni.Co+prueba2@gmail.com", password: "password-segura" }))
      .rejects.toMatchObject<AuthError>({ statusCode: 409 });
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ email: "Ni.Co+prueba2@gmail.com" }, { emailCanonical: "nico@gmail.com" }] },
    }));
  });

  it("rechaza casillas descartables", async () => {
    await expect(registerUser({ email: "alguien@yopmail.com", password: "password-segura" }))
      .rejects.toMatchObject<AuthError>({ statusCode: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("crea la cuenta aunque el mail del código no salga", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue(baseUser);
    mocks.sendVerificationCode.mockRejectedValue(new Error("SES caído"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await registerUser({ email: baseUser.email, password: "password-segura" });

    expect(result.user.emailVerified).toBe(false);
  });

  it("inicia sesión con una contraseña válida", async () => {
    const password = "password-segura";
    mocks.findUnique.mockResolvedValue({
      ...baseUser,
      passwordHash: await bcrypt.hash(password, 4),
    });

    const result = await loginUser({ email: baseUser.email, password });

    expect(result.user.email).toBe(baseUser.email);
    expect(result.token).toEqual(expect.any(String));
  });

  it("rechaza contraseña incorrecta y cuentas creadas sólo con Google", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({ ...baseUser, passwordHash: await bcrypt.hash("otra", 4) })
      .mockResolvedValueOnce({ ...baseUser, passwordHash: null });

    await expect(loginUser({ email: baseUser.email, password: "incorrecta" }))
      .rejects.toMatchObject<AuthError>({ statusCode: 401 });
    await expect(loginUser({ email: baseUser.email, password: "incorrecta" }))
      .rejects.toMatchObject<AuthError>({ statusCode: 401 });
  });

  it("crea una cuenta a partir de una credencial Google verificada", async () => {
    mocks.verifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: "google-1", email: "google@example.com", email_verified: true, name: "Google User" }),
    });
    mocks.findUnique.mockResolvedValue(null);
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue({
      id: "user-google", email: "google@example.com", name: "Google User", emailVerifiedAt: new Date(),
    });

    const result = await loginWithGoogle("credential");

    expect(result.user.email).toBe("google@example.com");
    expect(result.user.emailVerified).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        googleId: "google-1",
        email: "google@example.com",
        name: "Google User",
        emailCanonical: "google@example.com",
        emailVerifiedAt: expect.any(Date),
      },
    });
  });

  it("rechaza una credencial Google inválida", async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error("invalid token"));

    await expect(loginWithGoogle("credential-invalida"))
      .rejects.toMatchObject<AuthError>({ statusCode: 401 });
  });

  it("recupera el usuario autenticado sin datos sensibles", async () => {
    mocks.findUnique.mockResolvedValue({ id: baseUser.id, email: baseUser.email, name: baseUser.name, emailVerifiedAt: null });

    await expect(getAuthenticatedUser(baseUser.id)).resolves.toEqual({
      id: baseUser.id, email: baseUser.email, name: baseUser.name, emailVerified: false,
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: baseUser.id },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });
  });
});
