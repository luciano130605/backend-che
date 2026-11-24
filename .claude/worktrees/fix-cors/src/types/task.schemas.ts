import { z } from "zod";

// "2026-10-20" (todo el día), "2026-10-20T15:30" (hora de la zona del usuario)
// o un ISO completo con Z/offset. La conversión a Date la hace el controller con
// parseDueDate, porque z.coerce.date() lee "2026-10-20" como UTC y corre el día.
const DUE_DATE_FORMAT =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const dueDateField = z
  .string()
  .regex(DUE_DATE_FORMAT, "Fecha inválida. Usá AAAA-MM-DD o AAAA-MM-DDTHH:mm.");

// z.coerce.boolean() convierte "false" en true; los query params llegan siempre como texto.
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "El título es requerido."),
  rawText: z.string().min(1).optional(),
  categoryId: z.string().uuid("categoryId inválido.").optional(),
  dueDate: dueDateField.optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, "El título no puede quedar vacío.").optional(),
  categoryId: z.string().uuid("categoryId inválido.").nullable().optional(),
  dueDate: dueDateField.nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  status: z.enum(["PENDING", "DONE", "DISMISSED"]).optional(),
});

export const listTasksQuerySchema = z.object({
  status: z.enum(["PENDING", "DONE", "DISMISSED"]).optional(),
  categoryId: z.string().uuid().optional(),
  upcoming: booleanQuery.optional(),
  history: booleanQuery.optional(),
});
