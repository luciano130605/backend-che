import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { cancel, checkout, confirm, webhook } from "../controllers/payment.controller";

export const paymentRouter = Router();

paymentRouter.post("/webhook", webhook);

paymentRouter.use(requireAuth);
paymentRouter.post("/checkout", checkout);
paymentRouter.post("/confirm", confirm);
paymentRouter.post("/cancel", cancel);
