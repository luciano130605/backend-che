-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailCanonical" TEXT,
ADD COLUMN     "emailVerificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailVerificationCodeHash" TEXT,
ADD COLUMN     "emailVerificationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "emailVerificationSentAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- Las cuentas que ya existían quedan verificadas, para no trabar a nadie que ya usa la app.
UPDATE "users" SET "emailVerifiedAt" = "createdAt";

-- Mismo criterio que canonicalEmail() en email-verification.service.ts.
UPDATE "users" SET "emailCanonical" = CASE
  WHEN lower(split_part("email", '@', 2)) IN ('gmail.com', 'googlemail.com')
    THEN replace(split_part(split_part(lower("email"), '@', 1), '+', 1), '.', '') || '@gmail.com'
  ELSE split_part(split_part(lower("email"), '@', 1), '+', 1) || '@' || lower(split_part("email", '@', 2))
END;

-- CreateIndex
CREATE INDEX "users_emailCanonical_idx" ON "users"("emailCanonical");
