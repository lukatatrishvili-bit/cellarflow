-- Explicit per-channel consent. Existing users remain opted out.
ALTER TABLE "AiNotificationPreference"
  ADD COLUMN "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pushEnabledAt" TIMESTAMP(3),
  ADD COLUMN "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "whatsappEnabledAt" TIMESTAMP(3);

CREATE INDEX "AiNotificationPreference_organizationId_pushEnabled_idx"
  ON "AiNotificationPreference"("organizationId", "pushEnabled");
CREATE INDEX "AiNotificationPreference_organizationId_whatsappEnabled_idx"
  ON "AiNotificationPreference"("organizationId", "whatsappEnabled");

CREATE TABLE "AiPushSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "expirationTime" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiPushSubscription_organizationId_username_endpointHash_key"
  ON "AiPushSubscription"("organizationId", "username", "endpointHash");
CREATE INDEX "AiPushSubscription_organizationId_username_updatedAt_idx"
  ON "AiPushSubscription"("organizationId", "username", "updatedAt");

ALTER TABLE "AiPushSubscription"
  ADD CONSTRAINT "AiPushSubscription_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiPushSubscription"
  ADD CONSTRAINT "AiPushSubscription_username_fkey"
  FOREIGN KEY ("username") REFERENCES "User"("username")
  ON DELETE CASCADE ON UPDATE CASCADE;
