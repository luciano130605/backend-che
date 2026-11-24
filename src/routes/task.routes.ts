import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { create, getOne, list, remove, update } from "../controllers/task.controller";

export const taskRouter = Router();

taskRouter.use(requireAuth);

taskRouter.post("/", create);
taskRouter.get("/", list);
taskRouter.get("/:id", getOne);
taskRouter.patch("/:id", update);
taskRouter.delete("/:id", remove);
