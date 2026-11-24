import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  cancelSubscription,
  createProCheckout,
  isValidWebhookSignature,
  syncSubscription,
} from "../services/payment.service";

const checkoutSchema = z.object({ period: z.enum(["mensual", "anual"]) });
const confirmSchema = z.object({ preapprovalId: z.string().min(1) });

export async function checkout(req: Request, res: Response, next: NextFunction) {
  try {
    const { period } = checkoutSchema.parse(req.body);
    res.status(201).json(await createProCheckout(req.user!.userId, period));
  } catch (error) {
    next(error);
  }
}

// El front llama acá al volver de Mercado Pago (viene preapproval_id en la URL).
export async function confirm(req: Request, res: Response, next: NextFunction) {
  try {
    const { preapprovalId } = confirmSchema.parse(req.body);
    res.status(200).json(await syncSubscription(preapprovalId, req.user!.userId));
  } catch (error) {
    next(error);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    await cancelSubscription(req.user!.userId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// Webhook público: solo sirve de aviso. El estado real se consulta a Mercado Pago.
export async function webhook(req: Request, res: Response) {
  const type = String(req.body?.type ?? req.query.type ?? "");
  const dataId = String(req.body?.data?.id ?? req.query["data.id"] ?? "");

  if (!dataId || !isValidWebhookSignature(req.headers, dataId)) {
    res.status(401).end();
    return;
  }

  if (type === "subscription_preapproval") {
    try {
      await syncSubscription(dataId);
    } catch (error) {
      console.error("Webhook de Mercado Pago:", error);
    }
  }

  // Siempre 200 para que Mercado Pago no reintente avisos que no nos interesan.
  res.status(200).end();
}
