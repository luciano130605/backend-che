import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { env } from "../config/env";

const sesClient = new SESClient({
  region: env.aws.region,
  credentials: {
    accessKeyId: env.aws.accessKeyId,
    secretAccessKey: env.aws.secretAccessKey,
  },
});

export class EmailError extends Error {
  constructor(message: string, public statusCode: number = 502) {
    super(message);
    this.name = "EmailError";
  }
}

export async function sendEmail(to: string, subject: string, bodyText: string, bodyHtml?: string) {
  const command = new SendEmailCommand({
    Source: `Che <${env.sesFromEmail}>`,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Text: { Data: bodyText, Charset: "UTF-8" },
        ...(bodyHtml ? { Html: { Data: bodyHtml, Charset: "UTF-8" } } : {}),
      },
    },
  });

  try {
    await sesClient.send(command);
  } catch (error) {
    console.error("Error al enviar email via SES:", error);
    throw new EmailError("No se pudo enviar el email.");
  }
}
