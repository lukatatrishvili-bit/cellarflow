-- Tenant-owned retrieval knowledge and deterministic chunks. Embeddings remain
-- JSON so the release does not depend on a Cloud SQL extension rollout.
CREATE TABLE "AiKnowledgeDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "sourceUrl" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "agents" JSONB NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKnowledgeDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiKnowledgeDocument_language_check"
      CHECK ("language" IN ('en', 'ka')),
    CONSTRAINT "AiKnowledgeDocument_status_check"
      CHECK ("status" IN ('active', 'archived'))
);

CREATE TABLE "AiKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "embedding" JSONB,
    "embeddingModel" TEXT,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiKnowledgeChunk_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiKnowledgeChunk_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "AiKnowledgeChunk_token_count_check" CHECK ("tokenCount" >= 0)
);

CREATE UNIQUE INDEX "AiKnowledgeDocument_organizationId_contentHash_key"
  ON "AiKnowledgeDocument"("organizationId", "contentHash");
CREATE INDEX "AiKnowledgeDocument_organizationId_status_updatedAt_idx"
  ON "AiKnowledgeDocument"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "AiKnowledgeChunk_documentId_ordinal_key"
  ON "AiKnowledgeChunk"("documentId", "ordinal");
CREATE INDEX "AiKnowledgeChunk_organizationId_documentId_idx"
  ON "AiKnowledgeChunk"("organizationId", "documentId");

ALTER TABLE "AiKnowledgeDocument"
  ADD CONSTRAINT "AiKnowledgeDocument_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiKnowledgeDocument"
  ADD CONSTRAINT "AiKnowledgeDocument_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("username")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiKnowledgeChunk"
  ADD CONSTRAINT "AiKnowledgeChunk_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiKnowledgeChunk"
  ADD CONSTRAINT "AiKnowledgeChunk_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "AiKnowledgeDocument"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
