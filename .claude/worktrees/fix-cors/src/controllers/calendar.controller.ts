import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import {
  CalendarError,
  buildAuthUrl,
  completeConnection,
  disconnectCalendar,
  getCalendarStatus,
} from "../services/calendar.service";

export async function connect(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ url: buildAuthUrl(req.user!.userId) });
  } catch (error) {
    next(error);
  }
}

export async function status(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await getCalendarStatus(req.user!.userId));
  } catch (error) {
    next(error);
  }
}

export async function disconnect(req: Request, res: Response, next: NextFunction) {
  try {
    await disconnectCalendar(req.user!.userId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/** Google redirige acá (sin Authorization): la identidad viene en el `state` firmado. */
export async function callback(req: Request, res: Response) {
  const { code, state, error } = req.query;
  const back = (result: string) => res.redirect(`${env.frontendUrl}/profile?calendar=${result}`);
  if (error || typeof code !== "string" || typeof state !== "string") return back("denied");
  try {
    await completeConnection(code, state);
    return back("connected");
  } catch (err) {
    if (!(err instanceof CalendarError)) console.error(err);
    return back("error");
  }
}
