import TelegramBot from "node-telegram-bot-api";
import { prisma } from "../config/prisma";
import { ParsedTaskItem } from "../types/bedrock.types";
import { bot, isSummaryRequest, replyWithSummary } from "./telegram.service";
import { formatDueDate } from "./due-date";
import { parseDueDate } from "./zoned-date";
import {
  InterpretationError,
  UNVERIFIED_MESSAGE,
  confirmInterpretation,
  discardPendingInterpretation,
  interpretText,
} from "./interpretation.service";
import { ACTION_LABEL, applyTaskAction, parseTaskActionData } from "./reminder.service";

const PRIORITY_ICON = { HIGH: "🔴", MEDIUM: "🟡", LOW: "🟢" } as const;
const MAX_TEXT_LENGTH = 2000;

function findUserByChat(chatId: string) {
  return prisma.user.findUnique({ where: { telegramChatId: chatId }, select: { id: true, timeZone: true } });
}

export function formatInterpretation(tasks: ParsedTaskItem[], timeZone: string) {
  const lines = tasks.map((task, index) => {
    const due = formatDueDate(parseDueDate(task.dueDate, timeZone) ?? null, timeZone);
    const category = task.categoryName ? ` · ${task.categoryName}` : "";
    return `${index + 1}. ${PRIORITY_ICON[task.priority]} ${task.title} — ${due}${category}`;
  });
  return `Entendí esto:\n\n${lines.join("\n")}\n\n¿Lo guardo? Si algo está mal, descartalo y mandámelo de nuevo corregido.`;
}

function confirmKeyboard(interpretationId: string): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "✓ Guardar", callback_data: `int:ok:${interpretationId}` },
      { text: "× Descartar", callback_data: `int:no:${interpretationId}` },
    ]],
  };
}

async function handleText(msg: TelegramBot.Message) {
  const text = msg.text?.trim();
  if (!text || text.startsWith("/")) return;
  const chatId = msg.chat.id.toString();

  if (isSummaryRequest(text)) {
    await replyWithSummary(chatId); // ya avisa si el chat no está vinculado
    return;
  }

  const user = await findUserByChat(chatId);
  if (!user) {
    await bot.sendMessage(chatId, "Todavía no vinculaste este chat. Abrí el link de Telegram desde tu perfil en la app de Che.");
    return;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    await bot.sendMessage(chatId, "Es muy largo para mí. Mandámelo en partes más cortas.");
    return;
  }

  await bot.sendChatAction(chatId, "typing");
  let result;
  try {
    result = await interpretText(user.id, text);
  } catch (error) {
    if (!(error instanceof InterpretationError) || error.message !== UNVERIFIED_MESSAGE) throw error;
    await bot.sendMessage(chatId, `${UNVERIFIED_MESSAGE} Lo ingresás en la app.`);
    return;
  }
  if (result.status === "FAILED") {
    await bot.sendMessage(chatId, `${result.message} Lo vas a ver en la app.`);
    return;
  }
  await bot.sendMessage(chatId, formatInterpretation(result.tasks, user.timeZone), {
    reply_markup: confirmKeyboard(result.interpretationId),
  });
}

/** Cierra el mensaje original: le agrega el resultado y le saca los botones. */
async function closeMessage(query: TelegramBot.CallbackQuery, suffix: string) {
  if (!query.message) return;
  await bot.editMessageText(`${query.message.text ?? ""}\n\n${suffix}`, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
  });
}

async function handleCallback(query: TelegramBot.CallbackQuery) {
  const data = query.data ?? "";
  const chatId = query.message?.chat.id.toString();
  const user = chatId ? await findUserByChat(chatId) : null;
  if (!user) {
    await bot.answerCallbackQuery(query.id, { text: "Este chat no está vinculado a una cuenta de Che." });
    return;
  }

  const interpretation = /^int:(ok|no):([0-9a-f-]{36})$/.exec(data);
  if (interpretation) {
    const [, decision, interpretationId] = interpretation;
    try {
      if (decision === "ok") {
        const tasks = await confirmInterpretation(user.id, interpretationId);
        await bot.answerCallbackQuery(query.id, { text: "Guardado ✓" });
        await closeMessage(query, `✓ ${tasks.length === 1 ? "Guardé la tarea" : `Guardé ${tasks.length} tareas`}.`);
      } else {
        await discardPendingInterpretation(user.id, interpretationId);
        await bot.answerCallbackQuery(query.id, { text: "Descartado" });
        await closeMessage(query, "× Descartado. Mandámelo de nuevo como quieras.");
      }
    } catch (error) {
      if (!(error instanceof InterpretationError)) throw error;
      await bot.answerCallbackQuery(query.id, { text: "Esto ya se resolvió antes." });
    }
    return;
  }

  const taskAction = parseTaskActionData(data);
  if (taskAction) {
    const task = await prisma.task.findFirst({ where: { id: taskAction.taskId, userId: user.id }, select: { id: true } });
    if (!task) {
      await bot.answerCallbackQuery(query.id, { text: "Esa tarea ya no existe." });
      return;
    }
    await applyTaskAction(task.id, taskAction.action);
    await bot.answerCallbackQuery(query.id, { text: ACTION_LABEL[taskAction.action] });
    await closeMessage(query, ACTION_LABEL[taskAction.action]);
    return;
  }

  await bot.answerCallbackQuery(query.id);
}

/** Telegram como canal de entrada: texto libre → interpretación → confirmar; y botones de recordatorios. */
export function initTelegramInput() {
  bot.on("message", (msg) => {
    handleText(msg).catch(async (error) => {
      console.error("Error al procesar un mensaje de Telegram:", error);
      await bot.sendMessage(msg.chat.id, "Uy, algo falló de mi lado. Probá de nuevo en un rato.").catch(() => undefined);
    });
  });

  bot.on("callback_query", (query) => {
    handleCallback(query).catch(async (error) => {
      console.error("Error al procesar un botón de Telegram:", error);
      await bot.answerCallbackQuery(query.id, { text: "No pude hacerlo. Probá de nuevo." }).catch(() => undefined);
    });
  });
}
