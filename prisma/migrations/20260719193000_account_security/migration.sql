-- Revoke existing sessions whenever a security-sensitive account mutation
-- increments this version.
ALTER TABLE "User"
ADD COLUMN "accountEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;

-- Preserve already-issued invitation links while replacing stored bearer
-- tokens with their SHA-256 digests. PostgreSQL's sha256(bytea) is built in.
ALTER TABLE "Invitation"
RENAME COLUMN "token" TO "tokenHash";

UPDATE "Invitation"
SET "tokenHash" = encode(sha256(convert_to("tokenHash", 'UTF8')), 'hex');

ALTER INDEX "Invitation_token_key"
RENAME TO "Invitation_tokenHash_key";

CREATE TABLE "SecurityAuditEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "username" TEXT,
    "actorUsername" TEXT,
    "organizationId" TEXT,
    "ipHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecurityAuditEvent_eventType_createdAt_idx"
ON "SecurityAuditEvent"("eventType", "createdAt");

CREATE INDEX "SecurityAuditEvent_username_createdAt_idx"
ON "SecurityAuditEvent"("username", "createdAt");
