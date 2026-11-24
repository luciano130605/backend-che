import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";

const BOT_USERNAME = "che_tareas_bot";

export async function getTelegramLink(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const link = `https://t.me/${BOT_USERNAME}?start=${userId}`;
    res.status(200).json({ link });
  } catch (error) {
    next(error);
  }
}

export async function getTelegramStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true },
    });
    res.status(200).json({ linked: Boolean(user?.telegramChatId) });
  } catch (error) {
    next(error);
  }
}
