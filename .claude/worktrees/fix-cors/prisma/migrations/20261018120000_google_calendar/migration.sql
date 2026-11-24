ALTER TABLE "users" ADD COLUMN "googleCalendarRefreshToken" TEXT;
ALTER TABLE "users" ADD COLUMN "googleCalendarConnectedAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "googleEventId" TEXT;
