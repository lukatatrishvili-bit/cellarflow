CREATE TABLE "AiNotificationPreference" (
    "organizationId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailEnabledAt" TIMESTAMP(3),
    "minimumSeverity" TEXT NOT NULL DEFAULT 'warning',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiNotificationPreference_pkey" PRIMARY KEY ("organizationId", "username")
);

ALTER TABLE "AiNotificationOutbox"
ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'email';

DROP INDEX "AiNotificationOutbox_organizationId_eventKey_recipientUsername_key";

CREATE UNIQUE INDEX "AiNotificationOutbox_organizationId_eventKey_recipientUsername_channel_key"
ON "AiNotificationOutbox"("organizationId", "eventKey", "recipientUsername", "channel");

CREATE INDEX "AiNotificationPreference_organizationId_emailEnabled_idx"
ON "AiNotificationPreference"("organizationId", "emailEnabled");

ALTER TABLE "AiNotificationPreference"
ADD CONSTRAINT "AiNotificationPreference_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiNotificationPreference"
ADD CONSTRAINT "AiNotificationPreference_username_fkey"
FOREIGN KEY ("username") REFERENCES "User"("username")
ON DELETE CASCADE ON UPDATE CASCADE;
