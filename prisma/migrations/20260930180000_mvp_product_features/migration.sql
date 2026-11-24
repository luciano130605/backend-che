ALTER TYPE "TaskStatus" ADD VALUE 'DISMISSED';

CREATE TYPE "InterpretationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED');
CREATE TYPE "NotificationActionType" AS ENUM ('DONE', 'TOMORROW', 'DISMISS');

ALTER TABLE "users"
  ADD COLUMN "quietHoursStart" TEXT,
  ADD COLUMN "quietHoursEnd" TEXT;

CREATE TABLE "interpretations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "originalText" TEXT NOT NULL,
  "parsedTasks" JSONB,
  "status" "InterpretationStatus" NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "interpretations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tasks" ADD COLUMN "interpretationId" TEXT;

CREATE TABLE "notification_logs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taskId" TEXT,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationStatus" NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "error" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_action_tokens" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "action" "NotificationActionType" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_action_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_action_tokens_tokenHash_key" ON "notification_action_tokens"("tokenHash");
ALTER TABLE "interpretations" ADD CONSTRAINT "interpretations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_interpretationId_fkey" FOREIGN KEY ("interpretationId") REFERENCES "interpretations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_action_tokens" ADD CONSTRAINT "notification_action_tokens_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
