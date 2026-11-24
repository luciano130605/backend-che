import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { triggerDailySummary, triggerReminders } from "../controllers/reminder-test.controller";

export const reminderTestRouter = Router();

reminderTestRouter.use(requireAuth);
reminderTestRouter.post("/trigger-daily-summary", triggerDailySummary);
reminderTestRouter.post("/trigger-reminders", triggerReminders);
