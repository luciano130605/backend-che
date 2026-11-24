import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { actionTokenSchema, quietHoursSchema, sendNowSchema, updateChannelSchema } from "../types/notification.schemas";
import {
  ACTION_LABEL,
  applyNotificationAction,
  buildNotificationPreview,
  sendDailySummaries,
  sendTestReminder,
} from "../services/reminder.service";

// --- Canal (lo usa el perfil) ---

export async function getPreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { notificationChannel: true, telegramChatId: true, plan: true },
    });

    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado." });
      return;
    }

    res.status(200).json({
      channel: user.notificationChannel,
      telegramLinked: Boolean(user.telegramChatId),
      plan: user.plan,
    });
  } catch (error) {
    next(error);
  }
}

export async function updatePreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const { channel } = updateChannelSchema.parse(req.body);
    const userId = req.user!.userId;

    if (channel !== "EMAIL") {
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { telegramChatId: true },
      });
      if (!current?.telegramChatId) {
        res.status(409).json({ error: "Primero vinculá tu cuenta de Telegram para recibir avisos ahí." });
        return;
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { notificationChannel: channel },
      select: { notificationChannel: true, telegramChatId: true },
    });

    res.status(200).json({
      channel: updated.notificationChannel,
      telegramLinked: Boolean(updated.telegramChatId),
    });
  } catch (error) {
    next(error);
  }
}

// --- "No molestar", historial, preview y envíos de prueba (panel de avisos) ---

const SETTINGS_SELECT = { quietHoursStart: true, quietHoursEnd: true, notificationChannel: true } as const;

export async function history(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await prisma.notificationLog.findMany({
      where: { userId: req.user!.userId }, orderBy: { sentAt: "desc" }, take: 50,
      select: {
        id: true, taskId: true, channel: true, status: true, subject: true, error: true, sentAt: true,
        task: { select: { title: true } },
      },
    });
    res.json({ notifications: items });
  } catch (error) { next(error); }
}

export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const settings = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: SETTINGS_SELECT });
    res.json({ settings });
  } catch (error) { next(error); }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const data = quietHoursSchema.parse(req.body);
    const settings = await prisma.user.update({ where: { id: req.user!.userId }, data, select: SETTINGS_SELECT });
    res.json({ settings });
  } catch (error) { next(error); }
}

export async function preview(req: Request, res: Response, next: NextFunction) {
  try { res.json(await buildNotificationPreview(req.user!.userId)); }
  catch (error) { next(error); }
}

export async function sendNow(req: Request, res: Response, next: NextFunction) {
  try {
    const { type } = sendNowSchema.parse(req.body ?? {});
    const userId = req.user!.userId;

    if (type === "reminder") {
      const result = await sendTestReminder(userId);
      if (!result.taskTitle) {
        res.json({ message: "No tenés tareas pendientes para probar un recordatorio." });
        return;
      }
      if (result.sent === 0) {
        res.status(502).json({ error: `No se pudo enviar el recordatorio. ${result.failures.join(" · ")}` });
        return;
      }
      res.json({
        message: `Recordatorio de prueba enviado: "${result.taskTitle}".${result.failures.length ? ` Falló: ${result.failures.join(" · ")}` : ""}`,
      });
      return;
    }

    const result = await sendDailySummaries({ onlyUserId: userId });
    if (result.withoutTasks > 0) {
      res.json({ message: "No tenés tareas pendientes para incluir en el resumen." });
      return;
    }
    if (result.sent === 0) {
      res.status(502).json({ error: `No se pudo enviar el resumen. ${result.failures.join(" · ")}` });
      return;
    }
    res.json({ message: `Resumen enviado.${result.failures.length ? ` Falló: ${result.failures.join(" · ")}` : ""}` });
  } catch (error) { next(error); }
}

// --- Links de los emails ---

export async function actionLanding(req: Request, res: Response) {
  try {
    const { token } = actionTokenSchema.parse(req.query);
    res.type("html").send(`<main style="font-family:sans-serif;max-width:520px;margin:80px auto"><h1>Confirmar acción</h1><p>Este enlace sólo puede usarse una vez.</p><form method="post"><input type="hidden" name="token" value="${token}"><button style="padding:12px 18px">Confirmar</button></form></main>`);
  } catch {
    res.status(400).type("html").send('<main style="font-family:sans-serif;max-width:520px;margin:80px auto"><h1>Enlace inválido</h1></main>');
  }
}

export async function action(req: Request, res: Response) {
  try {
    const { token } = actionTokenSchema.parse(req.body);
    const applied = await applyNotificationAction(token);
    res.type("html").send(`<main style="font-family:sans-serif;max-width:520px;margin:80px auto"><h1>Listo ✓</h1><p>Tarea ${ACTION_LABEL[applied].toLowerCase()}.</p><p>Ya podés cerrar esta ventana.</p></main>`);
  } catch {
    res.status(400).type("html").send('<main style="font-family:sans-serif;max-width:520px;margin:80px auto"><h1>Enlace inválido</h1><p>El enlace venció o ya fue utilizado.</p></main>');
  }
}
