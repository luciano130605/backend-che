import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import {
  action,
  actionLanding,
  getPreferences,
  getSettings,
  history,
  preview,
  sendNow,
  updatePreferences,
  updateSettings,
} from "../controllers/notification.controller";

export const notificationRouter = Router();

// Links de los emails: se abren sin sesión, la autorización es el token de un solo uso.
notificationRouter.get("/action", actionLanding);
notificationRouter.post("/action", action);

notificationRouter.use(requireAuth);
notificationRouter.get("/", history);
notificationRouter.get("/preferences", getPreferences);
notificationRouter.patch("/preferences", updatePreferences);
notificationRouter.get("/settings", getSettings);
notificationRouter.patch("/settings", updateSettings);
notificationRouter.get("/preview", preview);
notificationRouter.post("/send-now", sendNow);
