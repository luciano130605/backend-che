import TelegramBot from "node-telegram-bot-api";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { buildSummaryForUser } from "./summary.service";

// Polling en vez de webhooks: no requiere URL pública/HTTPS, más simple en desarrollo local.
// Solo una instancia por bot puede escuchar (TELEGRAM_POLLING=false en las demás); enviar funciona igual.
export const bot = new TelegramBot(env.telegramBotToken, { polling: env.telegramPolling });

export class TelegramError extends Error {
  constructor(message: string, public statusCode: number = 502) {
    super(message);
    this.name = "TelegramError";
  }
}

export const TELEGRAM_HTML_OPTIONS: TelegramBot.SendMessageOptions = {
  parse_mode: "HTML",
  disable_web_page_preview: true,
};

// "che, qué tenemos para hoy", "qué tengo mañana", "resumen", "/hoy"... pero no "pagar el ABL hoy",
// que es una tarea: por eso se exige una pregunta o que el mensaje sea solo la palabra clave.
const SUMMARY_INTENT = [
  /^(che[\s,]*)?(que|cuales|cuantas)\s+(cosas\s+)?(tengo|tenemos|hay|me\s+queda|nos\s+queda)\b/,
  /^(che[\s,]*)?(hoy|resumen|agenda|pendientes|mi\s+dia)[\s?!.]*$/,
];

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿¡]/g, "")
    .trim();

export function isSummaryRequest(text: string) {
  const normalized = normalize(text);
  return SUMMARY_INTENT.some((pattern) => pattern.test(normalized));
}

export async function replyWithSummary(chatId: string) {
  const user = await prisma.user.findUnique({
    where: { telegramChatId: chatId },
    select: { id: true, name: true, timeZone: true },
  });

  if (!user) {
    await bot.sendMessage(
      chatId,
      "Todavía no tengo tu cuenta vinculada. Abrí el link de Telegram que aparece en tu perfil de Che y volvé a escribirme."
    );
    return;
  }

  const { message } = await buildSummaryForUser(user);
  await bot.sendMessage(chatId, message.telegram, TELEGRAM_HTML_OPTIONS);
}

export function initTelegramListeners() {
  bot.onText(/\/start (.+)/, async (msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id.toString();
    const userId = match?.[1];

    if (!userId) return;

    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        await bot.sendMessage(chatId, "No pudimos identificar tu cuenta de Che. Generá un nuevo link desde la app.");
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { telegramChatId: chatId },
      });

      await bot.sendMessage(
        chatId,
        `¡Listo, ${user.name ?? ""}! Tu cuenta de Che quedó vinculada a este chat. Te voy a avisar acá tus tareas importantes. Podés mandarme tareas como si me escribieras un mensaje, y cuando quieras preguntame "che, qué tenemos para hoy".`.trim()
      );
    } catch (error) {
      console.error("Error al vincular Telegram:", error);
      await bot.sendMessage(chatId, "Ocurrió un error al vincular tu cuenta. Intentá de nuevo desde la app.");
    }
  });

  bot.onText(/^\/start$/, async (msg: TelegramBot.Message) => {
    await bot.sendMessage(
      msg.chat.id,
      "Para vincular tu cuenta, abrí este bot desde el link que te muestra la app de Che en tu perfil."
    );
  });

  bot.onText(/^\/hoy(?:@\w+)?$/i, async (msg: TelegramBot.Message) => {
    try {
      await replyWithSummary(msg.chat.id.toString());
    } catch (error) {
      console.error("Error al responder /hoy:", error);
      await bot.sendMessage(msg.chat.id, "No pude armar tu resumen ahora. Probá de nuevo en un rato.");
    }
  });

  // Los mensajes de texto libre los maneja telegram.input (resumen o tarea nueva).
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options: TelegramBot.SendMessageOptions = {}
) {
  try {
    await bot.sendMessage(chatId, text, options);
  } catch (error) {
    console.error("Error al enviar mensaje de Telegram:", error);
    throw new TelegramError("No se pudo enviar el mensaje por Telegram.");
  }
}
