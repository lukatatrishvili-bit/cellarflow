-- Preserve historic WhatsApp rows, but prevent any legacy AI delivery from being retried.
UPDATE "AiNotificationPreference"
SET "whatsappEnabled" = false,
    "whatsappEnabledAt" = NULL
WHERE "whatsappEnabled" = true OR "whatsappEnabledAt" IS NOT NULL;

UPDATE "AiNotificationOutbox"
SET "status" = 'cancelled',
    "claimToken" = NULL,
    "claimedAt" = NULL,
    "lastError" = 'WhatsApp notifications were removed in favor of email and browser push.',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "channel" = 'whatsapp'
  AND "status" IN ('pending', 'processing', 'failed');

CREATE TABLE "TaskNotificationDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "assigneeUsername" TEXT NOT NULL,
    "senderUsername" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "claimToken" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaskNotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskNotificationDelivery_organizationId_taskId_channel_key"
ON "TaskNotificationDelivery"("organizationId", "taskId", "channel");

CREATE INDEX "TaskNotificationDelivery_organizationId_status_updatedAt_idx"
ON "TaskNotificationDelivery"("organizationId", "status", "updatedAt");

CREATE INDEX "TaskNotificationDelivery_status_updatedAt_idx"
ON "TaskNotificationDelivery"("status", "updatedAt");

ALTER TABLE "TaskNotificationDelivery"
ADD CONSTRAINT "TaskNotificationDelivery_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
