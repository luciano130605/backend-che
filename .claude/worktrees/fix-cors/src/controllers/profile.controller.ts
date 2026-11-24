import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { describeUsage } from "../services/usage.service";
import bcrypt from "bcryptjs";
import { AuthError } from "../services/auth.service";
import { deleteAccountSchema, updateProfileSchema } from "../types/profile.schemas";

/** Elimina la cuenta y todo lo suyo (tareas, avisos, grupos: se borran en cascada). Pide la contraseña. */
export async function deleteAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const { password } = deleteAccountSchema.parse(req.body);
    const userId = req.user!.userId;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user) throw new AuthError("Usuario no encontrado.", 404);
    if (!user.passwordHash) {
      throw new AuthError(
        "Tu cuenta no tiene contraseña. Creá una con “¿Olvidaste tu contraseña?” en el login y volvé a intentar.",
        400,
      );
    }
    // 403 y no 401: un 401 hace que el frontend cierre la sesión por una contraseña mal escrita.
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new AuthError("La contraseña no es correcta.", 403);
    }

    await prisma.user.delete({ where: { id: userId } });
    res.status(200).json({ message: "Tu cuenta fue eliminada." });
  } catch (error) {
    next(error);
  }
}

const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  timeZone: true,
  dailySummaryTime: true,
  notificationChannel: true,
  telegramChatId: true,
  plan: true,
  messagesUsed: true,
  usagePeriod: true,
} as const;

interface ProfileRow {
  id: string;
  email: string;
  name: string | null;
  timeZone: string;
  dailySummaryTime: string;
  notificationChannel: string;
  telegramChatId: string | null;
  plan: string;
  messagesUsed: number;
  usagePeriod: string | null;
}

function toProfile(user: ProfileRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    timeZone: user.timeZone,
    dailySummaryTime: user.dailySummaryTime,
    channel: user.notificationChannel,
    telegramLinked: Boolean(user.telegramChatId),
    plan: user.plan,
    usage: describeUsage(user),
  };
}

export async function getProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: PROFILE_SELECT,
    });

    if (!user) {
      res.status(404).json({ error: "Usuario no encontrado." });
      return;
    }

    res.status(200).json(toProfile(user));
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const changes = updateProfileSchema.parse(req.body);
    const userId = req.user!.userId;

    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { timeZone: true, dailySummaryTime: true },
    });

    if (!current) {
      res.status(404).json({ error: "Usuario no encontrado." });
      return;
    }

    // Si cambia la hora o la zona, el resumen de hoy se vuelve a habilitar para que salga a la nueva hora.
    const scheduleChanged =
      (changes.timeZone !== undefined && changes.timeZone !== current.timeZone) ||
      (changes.dailySummaryTime !== undefined && changes.dailySummaryTime !== current.dailySummaryTime);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { ...changes, ...(scheduleChanged ? { lastSummaryOn: null } : {}) },
      select: PROFILE_SELECT,
    });

    res.status(200).json(toProfile(updated));
  } catch (error) {
    next(error);
  }
}
