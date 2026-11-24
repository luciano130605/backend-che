import { NextFunction, Request, Response } from "express";
import { confirmInterpretationSchema, parseTextSchema } from "../types/bedrock.schemas";
import {
  confirmInterpretation as confirm,
  deleteUnparsed,
  interpretText,
  listUnparsed,
  retryUnparsed,
  saveUnparsedAsTask,
} from "../services/interpretation.service";

export async function previewInterpretation(req: Request, res: Response, next: NextFunction) {
  try {
    const { rawText } = parseTextSchema.parse(req.body);
    const result = await interpretText(req.user!.userId, rawText);
    res.status(result.status === "FAILED" ? 202 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function confirmInterpretation(req: Request, res: Response, next: NextFunction) {
  try {
    const { interpretationId, tasks } = confirmInterpretationSchema.parse(req.body);
    const createdTasks = await confirm(req.user!.userId, interpretationId, tasks);
    res.status(201).json({ tasks: createdTasks });
  } catch (error) {
    next(error);
  }
}

export async function unparsed(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ items: await listUnparsed(req.user!.userId) });
  } catch (error) {
    next(error);
  }
}

export async function retry(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await retryUnparsed(req.user!.userId, req.params.id);
    res.status(result.status === "FAILED" ? 202 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function saveAsTask(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json({ task: await saveUnparsedAsTask(req.user!.userId, req.params.id) });
  } catch (error) {
    next(error);
  }
}

export async function removeUnparsed(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteUnparsed(req.user!.userId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
