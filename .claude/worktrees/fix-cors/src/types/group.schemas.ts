import { z } from "zod";

export const createGroupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Poné un nombre para el grupo.")
    .max(50, "El nombre del grupo puede tener hasta 50 caracteres."),
});

export const joinGroupSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Ingresá el código de invitación.")
    .max(20, "El código de invitación no es válido."),
});
