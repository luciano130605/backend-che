import crypto from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { sendEmail } from "./email.service";

export class VerificationError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "VerificationError";
  }
}

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

// Casillas descartables más usadas. No es una lista completa: frena el abuso casual.
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com", "10minutemail.net", "20minutemail.com", "33mail.com", "dispostable.com",
  "emailondeck.com", "fakeinbox.com", "getairmail.com", "getnada.com", "guerrillamail.com",
  "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com", "sharklasers.com",
  "grr.la", "inboxkitten.com", "maildrop.cc", "mailinator.com", "mailinator.net", "mailnesia.com",
  "mintemail.com", "mohmal.com", "moakt.com", "mytemp.email", "nada.email", "spamgourmet.com",
  "temp-mail.org", "temp-mail.io", "tempail.com", "tempmail.com", "tempmail.net", "tempmailo.com",
  "tempr.email", "throwawaymail.com", "trashmail.com", "trashmail.net", "yopmail.com", "yopmail.net",
  "yopmail.fr", "mailpoof.com", "emailfake.com", "burnermail.io", "tmail.ws", "tmpmail.org",
]);

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * Lleva un email a su forma canónica para detectar la misma casilla escrita de otra manera:
 * minúsculas, sin el alias "+algo" y, en Gmail, sin puntos (ni.co+2@gmail.com → nico@gmail.com).
 * La migración 20261112120000_email_verification aplica el mismo criterio en SQL.
 */
export function canonicalEmail(email: string): string {
  const [rawLocal, rawDomain = ""] = email.trim().toLowerCase().split("@");
  const domain = GMAIL_DOMAINS.has(rawDomain) ? "gmail.com" : rawDomain;
  let local = rawLocal.split("+")[0];
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}

const hashCode = (code: string) => crypto.createHmac("sha256", env.jwtSecret).update(code).digest("hex");

function sameHash(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verificationEmail(code: string) {
  const subject = `${code} es tu código de Che`;
  const text = [
    `Tu código para verificar tu cuenta de Che es: ${code}`,
    "",
    `Vence en ${CODE_TTL_MINUTES} minutos. Si no creaste una cuenta, ignorá este mail.`,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#1f1d2b">
  <p>Tu código para verificar tu cuenta de Che es:</p>
  <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
  <p style="color:#6b6880;font-size:13px">Vence en ${CODE_TTL_MINUTES} minutos. Si no creaste una cuenta, ignorá este mail.</p>
</div>`;
  return { subject, text, html };
}

/** Genera un código nuevo (invalida el anterior) y lo manda por mail. Respeta un mínimo entre envíos. */
export async function sendVerificationCode(userId: string, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true, emailVerificationSentAt: true },
  });
  if (!user) throw new VerificationError("Usuario no encontrado.", 404);
  if (user.emailVerifiedAt) throw new VerificationError("Tu email ya está verificado.", 409);

  if (user.emailVerificationSentAt) {
    const waitSeconds = Math.ceil(
      RESEND_COOLDOWN_SECONDS - (now.getTime() - user.emailVerificationSentAt.getTime()) / 1000,
    );
    if (waitSeconds > 0) {
      throw new VerificationError(`Esperá ${waitSeconds} segundos para pedir otro código.`, 429);
    }
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.user.update({
    where: { id: userId },
    data: {
      emailVerificationCodeHash: hashCode(code),
      emailVerificationExpiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
      emailVerificationAttempts: 0,
      emailVerificationSentAt: now,
    },
  });

  const message = verificationEmail(code);
  await sendEmail(user.email, message.subject, message.text, message.html);
}

/** Valida el código. Después de MAX_ATTEMPTS errores hay que pedir uno nuevo. */
export async function verifyEmailCode(userId: string, code: string, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      emailVerifiedAt: true,
      emailVerificationCodeHash: true,
      emailVerificationExpiresAt: true,
      emailVerificationAttempts: true,
    },
  });
  if (!user) throw new VerificationError("Usuario no encontrado.", 404);
  if (user.emailVerifiedAt) return;

  if (!user.emailVerificationCodeHash || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt <= now) {
    throw new VerificationError("El código venció. Pedí uno nuevo.", 410);
  }
  if (user.emailVerificationAttempts >= MAX_ATTEMPTS) {
    throw new VerificationError("Demasiados intentos. Pedí un código nuevo.", 429);
  }

  if (!sameHash(hashCode(code.trim()), user.emailVerificationCodeHash)) {
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerificationAttempts: { increment: 1 } },
    });
    throw new VerificationError("El código no es correcto.", 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      emailVerifiedAt: now,
      emailVerificationCodeHash: null,
      emailVerificationExpiresAt: null,
      emailVerificationAttempts: 0,
    },
  });
}

export async function isEmailVerified(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
  return Boolean(user?.emailVerifiedAt);
}
