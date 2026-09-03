-- Metadata-only model-call telemetry. This table intentionally has no prompt,
-- response, question, entity id, source reference, or arbitrary text column.
CREATE TABLE "AiModelCallTelemetry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "agent" TEXT,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "errorCategory" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelCallTelemetry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiModelCallTelemetry_status_check"
      CHECK ("status" IN ('running', 'succeeded', 'invalid_response', 'failed')),
    CONSTRAINT "AiModelCallTelemetry_latency_check"
      CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0)
);

CREATE INDEX "AiModelCallTelemetry_organizationId_startedAt_idx"
ON "AiModelCallTelemetry"("organizationId", "startedAt");

CREATE INDEX "AiModelCallTelemetry_status_startedAt_idx"
ON "AiModelCallTelemetry"("status", "startedAt");

CREATE INDEX "AiModelCallTelemetry_startedAt_idx"
ON "AiModelCallTelemetry"("startedAt");

ALTER TABLE "AiModelCallTelemetry"
ADD CONSTRAINT "AiModelCallTelemetry_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
