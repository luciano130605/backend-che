import cron from "node-cron";
import { sendDueDailySummaries, sendPendingReminders } from "../services/reminder.service";

export function startReminderJobs() {
  cron.schedule("* * * * *", async () => {
    try {
      const result = await sendDueDailySummaries();
      if (result.sent || result.failed) console.log("[cron] Resúmenes diarios:", result);
    } catch (error) {
      console.error("[cron] Falló el resumen diario:", error);
    }
  });

  cron.schedule("*/15 * * * *", async () => {
    try {
      const result = await sendPendingReminders();
      if (result.sent || result.failed) console.log("[cron] Recordatorios:", result);
    } catch (error) {
      console.error("[cron] Fallaron los recordatorios puntuales:", error);
    }
  });

  console.log("[cron] Jobs de recordatorios iniciados.");
}
