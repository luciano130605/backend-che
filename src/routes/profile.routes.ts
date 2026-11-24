import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { deleteAccount, getProfile, updateProfile } from "../controllers/profile.controller";

export const profileRouter = Router();

profileRouter.use(requireAuth);
profileRouter.get("/", getProfile);
profileRouter.patch("/", updateProfile);
profileRouter.delete("/account", deleteAccount);
