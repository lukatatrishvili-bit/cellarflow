-- Manual approval gate for self-service registrations. Existing accounts keep
-- working: the column default marks every already-provisioned user approved,
-- and only new signups are written as 'pending'.
ALTER TABLE "User"
ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN "approvalRequestedAt" TIMESTAMP(3),
ADD COLUMN "approvalDecidedAt" TIMESTAMP(3),
ADD COLUMN "approvalDecidedBy" TEXT,
ADD COLUMN "approvalTokenHash" TEXT,
ADD COLUMN "approvalTokenExpires" BIGINT;

-- Reviewers list pending requests oldest-first.
CREATE INDEX "User_approvalStatus_approvalRequestedAt_idx"
ON "User"("approvalStatus", "approvalRequestedAt");
