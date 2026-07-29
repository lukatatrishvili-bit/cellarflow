-- A model-call budget must be shared by every application instance. Keeping
-- the counter outside OrganizationState also avoids rewriting the winery JSONB
-- document for every model request.
CREATE TABLE "AiModelCallUsage" (
    "organizationId" TEXT NOT NULL,
    "usageDate" DATE NOT NULL,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelCallUsage_pkey" PRIMARY KEY ("organizationId", "usageDate")
);

CREATE INDEX "AiModelCallUsage_usageDate_idx"
ON "AiModelCallUsage"("usageDate");

ALTER TABLE "AiModelCallUsage"
ADD CONSTRAINT "AiModelCallUsage_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
