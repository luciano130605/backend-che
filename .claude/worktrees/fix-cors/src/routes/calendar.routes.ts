import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { callback, connect, disconnect, status } from "../controllers/calendar.controller";

export const calendarRouter = Router();

calendarRouter.get("/callback", callback);
calendarRouter.use(requireAuth);
calendarRouter.get("/connect", connect);
calendarRouter.get("/status", status);
calendarRouter.delete("/", disconnect);
