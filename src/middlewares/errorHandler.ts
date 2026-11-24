import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AuthError } from "../services/auth.service";
import { TaskError } from "../services/task.service";
import { BedrockError } from "../services/bedrock.service";
import { TelegramError } from "../services/telegram.service";
import { EmailError } from "../services/email.service";
import { PaymentError } from "../services/payment.service";
import { PlanLimitError } from "../services/usage.service";
import { CalendarError } from "../services/calendar.service";
import { InterpretationError } from "../services/interpretation.service";
import { VerificationError } from "../services/email-verification.service";
import { PasswordResetError } from "../services/password-reset.service";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Datos inválidos.",
      details: err.issues.map((e) => ({ field: e.path.join("."), message: e.message })),
    });
  }

  if (err instanceof PlanLimitError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }

  if (
    err instanceof AuthError ||
    err instanceof TaskError ||
    err instanceof PaymentError ||
    err instanceof BedrockError ||
    err instanceof TelegramError ||
    err instanceof EmailError ||
    err instanceof CalendarError ||
    err instanceof InterpretationError ||
    err instanceof VerificationError ||
    err instanceof PasswordResetError
  ) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  console.error(err);
  return res.status(500).json({ error: "Error interno del servidor." });
}
