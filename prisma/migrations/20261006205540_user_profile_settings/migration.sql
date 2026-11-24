-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dailySummaryTime" TEXT NOT NULL DEFAULT '08:00',
ADD COLUMN     "lastSummaryOn" TEXT,
ADD COLUMN     "messagesUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
ADD COLUMN     "usagePeriod" TEXT;
