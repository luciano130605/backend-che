/*
  Warnings:

  - A unique constraint covering the columns `[telegramChatId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "notifiedAt" TIMESTAMP(3),
ADD COLUMN     "reminderAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "telegramChatId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_telegramChatId_key" ON "users"("telegramChatId");
