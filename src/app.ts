import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth.routes";
import { taskRouter } from "./routes/task.routes";
import { bedrockRouter } from "./routes/bedrock.routes";
import { telegramRouter } from "./routes/telegram.routes";
import { notificationRouter } from "./routes/notification.routes";
import { profileRouter } from "./routes/profile.routes";
import { paymentRouter } from "./routes/payment.routes";
import { categoryRouter } from "./routes/category.routes";
import { reminderTestRouter } from "./routes/reminder-test.routes";
import { errorHandler } from "./middlewares/errorHandler";
import { env } from "./config/env";
import { calendarRouter } from "./routes/calendar.routes";
import { groupRouter } from "./routes/group.routes";

export const app = express();

const normalizeOrigin = (value: string) => value.trim().replace(/\/+$/, "");

const allowedOrigins = new Set(
  [
    env.frontendUrl,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(process.env.CORS_ORIGINS ?? "").split(","),
  ]
    .map(normalizeOrigin)
    .filter(Boolean),
);

app.use(cors({
  // Si el origen no está permitido, simplemente no se agregan headers CORS (sin lanzar error/500).
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(normalizeOrigin(origin)));
  },
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/tasks", taskRouter);
app.use("/api/ai", bedrockRouter);
app.use("/api/telegram", telegramRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/profile", profileRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/categories", categoryRouter);
app.use("/api/dev", reminderTestRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/groups", groupRouter);

app.use(errorHandler);
