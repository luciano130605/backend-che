import { NextFunction, Request, Response } from "express";
import { getAuthenticatedUser, loginUser, loginWithGoogle, registerUser } from "../services/auth.service";
import { sendVerificationCode, verifyEmailCode } from "../services/email-verification.service";
import { requestPasswordReset, resetPassword } from "../services/password-reset.service";
import { forgotPasswordSchema, googleSchema, loginSchema, registerSchema, resetPasswordSchema, verifyEmailSchema } from "../types/auth.schemas";

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    await requestPasswordReset(email);
    // Misma respuesta exista o no la cuenta, para no revelar qué emails están registrados.
    res.status(200).json({ message: "Si el email tiene una cuenta, te mandamos un código de 6 números." });
  } catch (error) {
    next(error);
  }
}

export async function resetPasswordWithCode(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, code, password } = resetPasswordSchema.parse(req.body);
    await resetPassword(email, code, password);
    res.status(200).json({ message: "Listo, cambiaste tu contraseña. Ya podés ingresar." });
  } catch (error) {
    next(error);
  }
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = registerSchema.parse(req.body);
    const result = await registerUser(parsed);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = loginSchema.parse(req.body);
    const result = await loginUser(parsed);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function googleLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { credential } = googleSchema.parse(req.body);
    res.status(200).json(await loginWithGoogle(credential));
  } catch (error) {
    next(error);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = verifyEmailSchema.parse(req.body);
    await verifyEmailCode(req.user!.userId, code);
    res.status(200).json({ user: await getAuthenticatedUser(req.user!.userId) });
  } catch (error) {
    next(error);
  }
}

export async function resendVerification(req: Request, res: Response, next: NextFunction) {
  try {
    await sendVerificationCode(req.user!.userId);
    res.status(200).json({ message: "Te mandamos un código nuevo." });
  } catch (error) {
    next(error);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ user: await getAuthenticatedUser(req.user!.userId) });
  } catch (error) {
    next(error);
  }
}
