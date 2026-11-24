import { z } from "zod";

export const updateChannelSchema = z.object({
  channel: z.enum(["EMAIL", "TELEGRAM", "BOTH"]),
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usá el formato HH:mm.");

// El canal se cambia desde el perfil (/preferences); acá solo el horario de "no molestar".
export const quietHoursSchema = z.object({
  quietHoursStart: time.nullable(),
  quietHoursEnd: time.nullable(),
});

export const actionTokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });

export const sendNowSchema = z.object({ type: z.enum(["summary", "reminder"]).default("summary") });
