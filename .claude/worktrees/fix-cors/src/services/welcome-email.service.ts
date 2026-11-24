import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { sendEmail } from "./email.service";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function welcomeEmail(name: string | null) {
  const firstName = name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `¡Hola ${firstName}!` : "¡Hola!";
  const appUrl = env.frontendUrl.replace(/\/+$/, "");

  const subject = "¡Bienvenido a Che!";
  const text = [
    greeting,
    "",
    "Gracias por sumarte a Che. Escribile lo que tenés que hacer como si le mandaras un mensaje y Che lo organiza en tu semana: tareas, fechas y recordatorios.",
    "",
    `Entrá cuando quieras: ${appUrl}/app`,
    "",
    "Si no fuiste vos, ignorá este mail.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#1f1d2b;max-width:480px">
  <h2 style="margin:0 0 12px">${escapeHtml(greeting)}</h2>
  <p>Gracias por sumarte a <b>Che</b>. Escribile lo que tenés que hacer como si le mandaras un mensaje y Che lo organiza en tu semana: tareas, fechas y recordatorios.</p>
  <p><a href="${escapeHtml(appUrl)}/app" style="display:inline-block;background:#1f1d2b;color:#fff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:10px">Abrir Che</a></p>
  <p style="color:#6b6880;font-size:13px">Si no fuiste vos, ignorá este mail.</p>
</div>`;
  return { subject, text, html };
}

/**
 * Manda el mail de bienvenida una sola vez por cuenta (en el primer ingreso o registro).
 * Reserva el envío de forma atómica para que dos logins simultáneos no lo dupliquen, y si el mail
 * falla libera la reserva para reintentar en el próximo ingreso. Nunca rompe el login.
 */
export async function sendWelcomeEmailOnce(user: { id: string; email: string; name: string | null }, now = new Date()) {
  try {
    const claimed = await prisma.user.updateMany({
      where: { id: user.id, welcomeEmailSentAt: null },
      data: { welcomeEmailSentAt: now },
    });
    if (claimed.count === 0) return;

    const message = welcomeEmail(user.name);
    try {
      await sendEmail(user.email, message.subject, message.text, message.html);
    } catch (error) {
      await prisma.user.update({ where: { id: user.id }, data: { welcomeEmailSentAt: null } });
      throw error;
    }
  } catch (error) {
    console.error("No se pudo enviar el mail de bienvenida:", error);
  }
}
