-- Durable WhatsApp task delivery state. This is intentionally separate from
-- the client-synced task snapshot so signed Meta webhooks can be applied even
-- when the originating browser is offline or has closed.
CREATE TABLE "WhatsAppDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "assigneeUsername" TEXT NOT NULL,
    "senderUsername" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "claimToken" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppDelivery_providerMessageId_key"
ON "WhatsAppDelivery"("providerMessageId");

CREATE UNIQUE INDEX "WhatsAppDelivery_organizationId_taskId_key"
ON "WhatsAppDelivery"("organizationId", "taskId");

CREATE INDEX "WhatsAppDelivery_organizationId_status_updatedAt_idx"
ON "WhatsAppDelivery"("organizationId", "status", "updatedAt");

CREATE INDEX "WhatsAppDelivery_status_updatedAt_idx"
ON "WhatsAppDelivery"("status", "updatedAt");

ALTER TABLE "WhatsAppDelivery"
ADD CONSTRAINT "WhatsAppDelivery_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
