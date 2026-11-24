import { NextFunction, Request, Response } from "express";
import { sendDailySummaries, sendPendingReminders } from "../services/reminder.service";

export async function triggerDailySummary(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await sendDailySummaries({ onlyUserId: req.user!.userId });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function triggerReminders(_req: Request, res: Response, next: NextFunction) {
  try {
    const result = await sendPendingReminders();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
