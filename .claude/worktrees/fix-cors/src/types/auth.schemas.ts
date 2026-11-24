import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("El email no es válido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
  name: z.string().min(1).optional(),
});

export const loginSchema = z.object({
  email: z.string().email("El email no es válido."),
  password: z.string().min(1, "La contraseña es requerida."),
});

export const verifyEmailSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 números."),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("El email no es válido."),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("El email no es válido."),
  code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 números."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
});

export const googleSchema = z.object({
  credential: z.string().min(1, "La credencial de Google es requerida."),
});
