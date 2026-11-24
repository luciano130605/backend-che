import { Router } from "express";
import { forgotPassword, googleLogin, login, me, register, resendVerification, resetPasswordWithCode, verifyEmail } from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/requireAuth";

export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/google", googleLogin);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPasswordWithCode);
authRouter.get("/me", requireAuth, me);
authRouter.post("/verify-email", requireAuth, verifyEmail);
authRouter.post("/resend-verification", requireAuth, resendVerification);
