import { z } from "zod";
import { isValidTimeZone } from "../services/zoned-date";

const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

export const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Contanos cómo querés que te llame Che.")
      .max(60, "El nombre puede tener hasta 60 caracteres.")
      .optional(),
    timeZone: z.string().refine(isValidTimeZone, "La zona horaria no es válida.").optional(),
    dailySummaryTime: z
      .string()
      .regex(TIME_FORMAT, "La hora del resumen debe tener formato HH:mm.")
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No hay nada para actualizar." });

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Ingresá tu contraseña para eliminar la cuenta."),
});
  