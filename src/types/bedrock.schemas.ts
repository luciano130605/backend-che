import { z } from "zod";

export const parseTextSchema = z.object({
  rawText: z.string().trim().min(1, "El texto es requerido.").max(2000),
});

const CATEGORIES = ["Finanzas", "Trabajo", "Salud", "Hogar", "Personal", "Otros"] as const;

export const parsedTaskSchema = z.object({
  title: z.string().trim().min(1).max(160),
  categoryName: z.string().nullable(),
  dueDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Fecha inválida.").nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

/** Lo que devuelve el modelo: más tolerante (categoría desconocida → null, prioridad faltante → MEDIUM). */
export const modelResponseSchema = z.object({
  tasks: z.array(parsedTaskSchema.extend({
    categoryName: z.string().nullish().transform((value) =>
      CATEGORIES.find((category) => category === value) ?? null),
    dueDate: parsedTaskSchema.shape.dueDate.nullish().transform((value) => value ?? null),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).catch("MEDIUM"),
  })).max(20),
});

export const confirmInterpretationSchema = z.object({
  interpretationId: z.string().uuid(),
  tasks: z.array(parsedTaskSchema).min(1).max(20),
});
