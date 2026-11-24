-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'TELEGRAM');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notificationChannel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'FREE';
