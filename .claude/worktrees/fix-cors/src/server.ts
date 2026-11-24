import { app } from "./app";
import { env } from "./config/env";
import { initTelegramListeners } from "./services/telegram.service";
import { initTelegramInput } from "./services/telegram.input";
import { startReminderJobs } from "./jobs/reminder.jobs";

app.listen(env.port, () => {
  console.log(`Che backend escuchando en http://localhost:${env.port}`);
  initTelegramListeners();
  initTelegramInput();
  startReminderJobs();
});
