import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";

export class PaymentError extends Error {
  constructor(message: string, public statusCode: number = 400) {
    super(message);
    this.name = "PaymentError";
  }
}

export type BillingPeriod = "mensual" | "anual";

// Precios de Che Pro en ARS (los mismos que muestra la página de planes).
const PRO_MONTHLY_PRICE = 14_999;
const PRO_ANNUAL_MONTHLY_PRICE = 11_999;

const MP_API = "https://api.mercadopago.com";

interface Preapproval {
  id: string;
  status: "pending" | "authorized" | "paused" | "cancelled";
  external_reference?: string;
  init_point?: string;
}

async function mpRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!env.mercadoPago.accessToken) {
    throw new PaymentError("Los pagos todavía no están configurados.", 503);
  }

  const response = await fetch(`${MP_API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${env.mercadoPago.accessToken}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const payload = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok || !payload) {
    console.error("Mercado Pago respondió", response.status, payload);
    throw new PaymentError(payload?.message ?? "Mercado Pago no pudo procesar el pedido.", 502);
  }
  return payload;
}

// Crea la suscripción pendiente y devuelve la URL de Mercado Pago donde el usuario la autoriza.
export async function createProCheckout(userId: string, period: BillingPeriod) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true },
  });
  if (!user) throw new PaymentError("Usuario no encontrado.", 404);
  if (user.plan === "PAID") throw new PaymentError("Ya tenés Che Pro activo.", 409);

  const annual = period === "anual";
  const preapproval = await mpRequest<Preapproval>("/preapproval", {
    method: "POST",
    body: {
      reason: annual ? "Che Pro · Anual" : "Che Pro · Mensual",
      external_reference: userId,
      payer_email: env.mercadoPago.testPayerEmail || user.email,
      back_url: `${env.mercadoPago.frontendUrl}/pagos`,
      status: "pending",
      auto_recurring: {
        frequency: annual ? 12 : 1,
        frequency_type: "months",
        transaction_amount: annual ? PRO_ANNUAL_MONTHLY_PRICE * 12 : PRO_MONTHLY_PRICE,
        currency_id: "ARS",
      },
    },
  });

  if (!preapproval.init_point) throw new PaymentError("Mercado Pago no devolvió el link de pago.", 502);

  await prisma.user.update({
    where: { id: userId },
    data: { mpSubscriptionId: preapproval.id, mpSubscriptionStatus: preapproval.status },
  });

  return { url: preapproval.init_point };
}

// Consulta la suscripción a Mercado Pago (nunca se confía en lo que manda el navegador o el webhook)
// y deja el plan del usuario en línea con su estado real.
export async function syncSubscription(preapprovalId: string, expectedUserId?: string) {
  const preapproval = await mpRequest<Preapproval>(`/preapproval/${encodeURIComponent(preapprovalId)}`);

  const userId = preapproval.external_reference;
  if (!userId) throw new PaymentError("La suscripción no pertenece a ningún usuario.", 404);
  if (expectedUserId && userId !== expectedUserId) {
    throw new PaymentError("Suscripción no encontrada.", 404);
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mpSubscriptionId: true } });
  if (!user || user.mpSubscriptionId !== preapproval.id) {
    throw new PaymentError("Suscripción no encontrada.", 404);
  }

  const active = preapproval.status === "authorized";
  await prisma.user.update({
    where: { id: userId },
    data: {
      plan: active ? "PAID" : "FREE",
      mpSubscriptionStatus: preapproval.status,
    },
  });

  return { status: preapproval.status, plan: active ? ("PAID" as const) : ("FREE" as const) };
}

export async function cancelSubscription(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mpSubscriptionId: true } });
  if (!user?.mpSubscriptionId) throw new PaymentError("No tenés una suscripción activa.", 404);

  await mpRequest<Preapproval>(`/preapproval/${encodeURIComponent(user.mpSubscriptionId)}`, {
    method: "PUT",
    body: { status: "cancelled" },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { plan: "FREE", mpSubscriptionStatus: "cancelled" },
  });
}

// Valida la firma de los webhooks (header x-signature) cuando hay MP_WEBHOOK_SECRET configurado.
export function isValidWebhookSignature(headers: Record<string, unknown>, dataId: string): boolean {
  const secret = env.mercadoPago.webhookSecret;
  if (!secret) return true;

  const signature = String(headers["x-signature"] ?? "");
  const requestId = String(headers["x-request-id"] ?? "");
  const parts = Object.fromEntries(signature.split(",").map((p) => p.trim().split("=") as [string, string]));
  if (!parts.ts || !parts.v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
