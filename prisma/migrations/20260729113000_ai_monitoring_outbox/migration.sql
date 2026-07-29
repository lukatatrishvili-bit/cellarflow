-- Durable, lease-protected monitoring runs.
CREATE TABLE "AiMonitoringRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "claimToken" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "evaluated" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "escalated" INTEGER NOT NULL DEFAULT 0,
    "autoResolved" INTEGER NOT NULL DEFAULT 0,
    "outboxQueued" INTEGER NOT NULL DEFAULT 0,
    "wineryStatus" TEXT,
    "briefing" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiMonitoringRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiMonitoringRun_organizationId_cadence_windowStart_key"
ON "AiMonitoringRun"("organizationId", "cadence", "windowStart");

CREATE INDEX "AiMonitoringRun_status_updatedAt_idx"
ON "AiMonitoringRun"("status", "updatedAt");

CREATE INDEX "AiMonitoringRun_organizationId_createdAt_idx"
ON "AiMonitoringRun"("organizationId", "createdAt");

ALTER TABLE "AiMonitoringRun"
ADD CONSTRAINT "AiMonitoringRun_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Finding transitions waiting for a channel-specific delivery worker.
CREATE TABLE "AiNotificationOutbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "findingDedupeKey" TEXT NOT NULL,
    "recipientUsername" TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "area" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiNotificationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiNotificationOutbox_organizationId_eventKey_recipientUsername_key"
ON "AiNotificationOutbox"("organizationId", "eventKey", "recipientUsername");

CREATE INDEX "AiNotificationOutbox_status_availableAt_idx"
ON "AiNotificationOutbox"("status", "availableAt");

CREATE INDEX "AiNotificationOutbox_organizationId_recipientUsername_createdAt_idx"
ON "AiNotificationOutbox"("organizationId", "recipientUsername", "createdAt");

ALTER TABLE "AiNotificationOutbox"
ADD CONSTRAINT "AiNotificationOutbox_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiNotificationOutbox"
ADD CONSTRAINT "AiNotificationOutbox_recipientUsername_fkey"
FOREIGN KEY ("recipientUsername") REFERENCES "User"("username")
ON DELETE CASCADE ON UPDATE CASCADE;
