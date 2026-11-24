import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { create, join, list } from "../controllers/group.controller";

export const groupRouter = Router();

groupRouter.use(requireAuth);

groupRouter.get("/", list);
groupRouter.post("/", create);
groupRouter.post("/join", join);
