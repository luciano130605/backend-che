import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { getTelegramLink, getTelegramStatus } from "../controllers/telegram.controller";

export const telegramRouter = Router();

telegramRouter.use(requireAuth);
telegramRouter.get("/link", getTelegramLink);
telegramRouter.get("/status", getTelegramStatus);
