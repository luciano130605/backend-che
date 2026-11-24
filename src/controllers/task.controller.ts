import { NextFunction, Request, Response } from "express";
import {
  TaskError,
  createTask,
  deleteTask,
  getTaskById,
  getUserTimeZone,
  listTasks,
  updateTask,
} from "../services/task.service";
import { parseDueDate } from "../services/zoned-date";
import {
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from "../types/task.schemas";

// El texto llega como "AAAA-MM-DD" o "AAAA-MM-DDTHH:mm" y se interpreta en la zona horaria del perfil.
async function toDueDate(userId: string, value: string): Promise<Date> {
  const date = parseDueDate(value, await getUserTimeZone(userId));
  if (!date) throw new TaskError("La fecha indicada no es válida.", 400);
  return date;
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { dueDate, ...rest } = createTaskSchema.parse(req.body);
    const task = await createTask(userId, {
      ...rest,
      dueDate: dueDate === undefined ? undefined : await toDueDate(userId, dueDate),
    });
    res.status(201).json(task);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listTasksQuerySchema.parse(req.query);
    const tasks = await listTasks(req.user!.userId, parsed);
    res.status(200).json(tasks);
  } catch (error) {
    next(error);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await getTaskById(req.user!.userId, req.params.id);
    res.status(200).json(task);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { dueDate, ...rest } = updateTaskSchema.parse(req.body);

    // undefined = no tocar la fecha, null = quitarla, texto = fecha nueva
    const resolvedDueDate =
      dueDate === undefined || dueDate === null ? dueDate : await toDueDate(userId, dueDate);

    const task = await updateTask(userId, req.params.id, { ...rest, dueDate: resolvedDueDate });
    res.status(200).json(task);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteTask(req.user!.userId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
