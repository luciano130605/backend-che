import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { JwtPayload, LoginInput, RegisterInput } from "../types/auth.types";
import { canonicalEmail, isDisposableEmail, sendVerificationCode } from "./email-verification.service";
import { sendWelcomeEmailOnce } from "./welcome-email.service";

const SALT_ROUNDS = 10;
const googleClient = new OAuth2Client();
const passwordUserFields = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  emailVerifiedAt: true,
} as const;

interface PublicUserSource {
  id: string;
  email: string;
  name: string | null;
  emailVerifiedAt: Date | null;
}

const publicUser = (user: PublicUserSource) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: Boolean(user.emailVerifiedAt),
});

export class AuthError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "AuthError";
  }
}

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export async function registerUser(input: RegisterInput) {
  if (isDisposableEmail(input.email)) {
    throw new AuthError("Usá tu email personal: no aceptamos casillas temporales.", 400);
  }

  // Misma casilla con otro alias (nico+2@gmail.com, ni.co@gmail.com) cuenta como la misma cuenta.
  const emailCanonical = canonicalEmail(input.email);
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { emailCanonical }] },
    select: { id: true },
  });

  if (existing) {
    throw new AuthError("Ya existe una cuenta con ese email.", 409);
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      emailCanonical,
      passwordHash,
      name: input.name,
    },
    select: passwordUserFields,
  });

  // Si el mail no sale, la cuenta queda creada igual: el código se puede pedir de nuevo desde la app.
  await sendVerificationCode(user.id).catch((error) => {
    console.error("No se pudo enviar el código de verificación:", error);
  });
  void sendWelcomeEmailOnce(user);

  const token = signToken({ userId: user.id, email: user.email });

  return {
    token,
    user: publicUser(user),
  };
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: passwordUserFields,
  });

  if (!user) {
    throw new AuthError("Email o contraseña incorrectos.", 401);
  }

  const passwordMatches = user.passwordHash
    ? await bcrypt.compare(input.password, user.passwordHash)
    : false;

  if (!passwordMatches) {
    throw new AuthError("Email o contraseña incorrectos.", 401);
  }

  void sendWelcomeEmailOnce(user);
  const token = signToken({ userId: user.id, email: user.email });

  return {
    token,
    user: publicUser(user),
  };
}

export async function loginWithGoogle(credential: string) {
  if (!env.googleClientId) {
    throw new AuthError("El acceso con Google no está configurado.", 503);
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new AuthError("Credencial de Google inválida.", 401);
  }

  if (!payload?.sub || !payload.email || !payload.email_verified) {
    throw new AuthError("La cuenta de Google no tiene un email verificado.", 401);
  }

  let user = await prisma.user.findUnique({ where: { googleId: payload.sub } });
  if (!user) {
    const emailCanonical = canonicalEmail(payload.email);
    const existingEmail = await prisma.user.findFirst({
      where: { OR: [{ email: payload.email }, { emailCanonical }] },
    });
    if (existingEmail) {
      throw new AuthError("Ese email ya tiene una cuenta. Ingresá con tu contraseña.", 409);
    }
    // Google ya verificó el mail (email_verified), así que la cuenta nace verificada.
    user = await prisma.user.create({
      data: {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        emailCanonical,
        emailVerifiedAt: new Date(),
      },
    });
  }

  void sendWelcomeEmailOnce(user);

  return {
    token: signToken({ userId: user.id, email: user.email }),
    user: publicUser(user),
  };
}

export async function getAuthenticatedUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerifiedAt: true },
  });

  if (!user) {
    throw new AuthError("Usuario no encontrado.", 401);
  }

  return publicUser(user);
}
