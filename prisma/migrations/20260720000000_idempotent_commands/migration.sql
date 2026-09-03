-- Durable idempotency claims for compound server-owned commands. A command's
-- domain mutation and its completed result are written in one transaction.
CREATE TABLE "CommandExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "actorUsername" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CommandExecution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommandExecution_organizationId_commandId_key"
ON "CommandExecution"("organizationId", "commandId");

CREATE INDEX "CommandExecution_organizationId_commandType_createdAt_idx"
ON "CommandExecution"("organizationId", "commandType", "createdAt");

ALTER TABLE "CommandExecution"
ADD CONSTRAINT "CommandExecution_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
