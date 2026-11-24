import { NextFunction, Request, Response } from "express";
import { GroupError, createGroup, joinGroup, listMyGroups } from "../services/group.service";
import { createGroupSchema, joinGroupSchema } from "../types/group.schemas";

// Los errores de grupos se responden acá, con su mensaje, para no depender de errorHandler.ts
// (archivo compartido con el resto del equipo). El resto de los errores sigue yendo a next().
function handleError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof GroupError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  next(error);
}

function firstIssueMessage(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await listMyGroups(req.user!.userId));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createGroupSchema.safeParse({ name: req.body?.name ?? "" });
    if (!parsed.success) throw new GroupError(firstIssueMessage(parsed.error), 400);

    res.status(201).json(await createGroup(req.user!.userId, parsed.data.name));
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function join(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = joinGroupSchema.safeParse({ code: req.body?.code ?? "" });
    if (!parsed.success) throw new GroupError(firstIssueMessage(parsed.error), 400);

    res.status(200).json(await joinGroup(req.user!.userId, parsed.data.code));
  } catch (error) {
    handleError(error, res, next);
  }
}
