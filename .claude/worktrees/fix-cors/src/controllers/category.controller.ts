import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";

export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    });
    res.status(200).json(categories);
  } catch (error) {
    next(error);
  }
}
