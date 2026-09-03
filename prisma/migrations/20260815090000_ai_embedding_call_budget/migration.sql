-- An embedding call and a generative call were both charged one unit of the
-- same daily budget, though they differ by roughly two orders of magnitude in
-- cost. Retrieval for a winery with a knowledge base could therefore spend the
-- allowance that deep analysis needed. Counted separately from here, against
-- their own limit, so `maxModelCallsPerDay` keeps meaning what it says.
ALTER TABLE "AiModelCallUsage"
ADD COLUMN "embeddingCount" INTEGER NOT NULL DEFAULT 0;
