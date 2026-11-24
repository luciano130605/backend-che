import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { sendEmail } from "./email.service";

export class PasswordResetError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "PasswordResetError";
  }
}

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const SALT_ROUNDS = 10;

const hashCode = (code: string) => crypto.createHmac("sha256", env.jwtSecret).update(code).digest("hex");

function sameHash(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function passwordResetEmail(code: string) {
  const subject = `${code} es tu código para recuperar tu contraseña de Che`;
  const text = [
    `Tu código para recuperar tu contraseña de Che es: ${code}`,
    "",
    `Vence en ${CODE_TTL_MINUTES} minutos. Si no lo pediste vos, ignorá este mail: tu contraseña no cambia.`,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#1f1d2b">
  <p>Tu código para recuperar tu contraseña de Che es:</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
  <p style="color:#6b6880;font-size:13px">Vence en ${CODE_TTL_MINUTES} minutos. Si no lo pediste vos, ignorá este mail: tu contraseña no cambia.</p>
</div>`;
  return { subject, text, html };
}

/**
 * Manda un código de recuperación. No revela si el email tiene cuenta: si no existe, o si pidió
 * otro código hace menos de un minuto, simplemente no hace nada y el caller responde igual.
 */
export async function requestPasswordReset(email: string, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { email: email.trim() },
    select: { id: true, email: true, passwordResetSentAt: true },
  });
  if (!user) return;

  if (
    user.passwordResetSentAt &&
    now.getTime() - user.passwordResetSentAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000
  ) {
    return;
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetCodeHash: hashCode(code),
      passwordResetExpiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
      passwordResetAttempts: 0,
      passwordResetSentAt: now,
    },
  });

  const message = passwordResetEmail(code);
  await sendEmail(user.email, message.subject, message.text, message.html);
}

/** Valida el código y cambia la contraseña. Después de MAX_ATTEMPTS errores hay que pedir uno nuevo. */
export async function resetPassword(email: string, code: string, newPassword: string, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { email: email.trim() },
    select: {
      id: true,
      emailVerifiedAt: true,
      passwordResetCodeHash: true,
      passwordResetExpiresAt: true,
      passwordResetAttempts: true,
    },
  });

  if (!user || !user.passwordResetCodeHash || !user.passwordResetExpiresAt || user.passwordResetExpiresAt <= now) {
    throw new PasswordResetError("El código venció o no es válido. Pedí uno nuevo.", 410);
  }
  if (user.passwordResetAttempts >= MAX_ATTEMPTS) {
    throw new PasswordResetError("Demasiados intentos. Pedí un código nuevo.", 429);
  }

  if (!sameHash(hashCode(code.trim()), user.passwordResetCodeHash)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetAttempts: { increment: 1 } },
    });
    throw new PasswordResetError("El código no es correcto.", 400);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS),
      passwordResetCodeHash: null,
      passwordResetExpiresAt: null,
      passwordResetAttempts: 0,
      // Recibir el código prueba que la casilla es suya.
      ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: now }),
    },
  });
}
