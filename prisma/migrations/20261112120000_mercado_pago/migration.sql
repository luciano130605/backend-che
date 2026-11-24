-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mpSubscriptionId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mpSubscriptionStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_mpSubscriptionId_key" ON "users"("mpSubscriptionId");
