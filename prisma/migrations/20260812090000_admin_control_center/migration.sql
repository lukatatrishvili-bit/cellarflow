ALTER TABLE "User"
ADD COLUMN "lastSeenAt" TIMESTAMP(3);

ALTER TABLE "Organization"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "deletionScheduledAt" TIMESTAMP(3),
ADD COLUMN "internalNotes" TEXT,
ADD COLUMN "internalTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "Organization_status_updatedAt_idx"
ON "Organization"("status", "updatedAt");

ALTER TABLE "Invitation"
ADD COLUMN "revokedAt" TIMESTAMP(3);
