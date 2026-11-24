import dotenv from "dotenv";

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Falta la variable de entorno: ${key}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  publicApiUrl: process.env.PUBLIC_API_URL ?? "http://localhost:3000",
  databaseUrl: required("DATABASE_URL"),
  directUrl: required("DIRECT_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCalendarRedirectUri:
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
    `${process.env.PUBLIC_API_URL ?? "http://localhost:3000"}/api/calendar/callback`,
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
  aws: {
    region: required("AWS_REGION"),
    accessKeyId: required("AWS_ACCESS_KEY_ID"),
    secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
    bedrockModelId: required("BEDROCK_MODEL_ID"),
  },
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  // Solo una instancia por bot puede escuchar mensajes; las demás (p. ej. otra compu de desarrollo) usan false.
  telegramPolling: process.env.TELEGRAM_POLLING !== "false",
  sesFromEmail: required("SES_FROM_EMAIL"),
  // Mercado Pago es opcional: sin token el servidor arranca y /payments responde 503.
  mercadoPago: {
    accessToken: process.env.MP_ACCESS_TOKEN ?? "",
    webhookSecret: process.env.MP_WEBHOOK_SECRET ?? "",
    // Mercado Pago exige una back_url https. En local usá un túnel (ngrok) o la URL deployada.
    frontendUrl: (process.env.FRONTEND_URL ?? "http://localhost:5173").trim().replace(/\/+$/, ""),
    // Solo para pruebas: con credenciales de prueba, el pagador debe ser un comprador de prueba de MP.
    testPayerEmail: (process.env.MP_TEST_PAYER_EMAIL ?? "").trim(),
  },
};
