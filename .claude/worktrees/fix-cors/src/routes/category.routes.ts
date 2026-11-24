import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { list } from "../controllers/category.controller";

export const categoryRouter = Router();

categoryRouter.use(requireAuth);

categoryRouter.get("/", list);
