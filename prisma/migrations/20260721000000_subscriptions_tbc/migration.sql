-- Organization subscriptions, usage, payment attempts, change requests, and
-- an immutable billing audit trail. Bank callbacks are reconciled against
-- BillingPayment before subscription state is changed.
CREATE TABLE "OrganizationSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingInterval" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "renewsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "promotionCode" TEXT,
    "capacityOverrideLiters" DOUBLE PRECISION,
    "featureOverrides" JSONB,
    "customPriceMinor" INTEGER,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 30,
    "capacityExceededAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "providerCustomerId" TEXT,
    "providerRecurringId" TEXT,
    "providerCardMask" TEXT,
    "providerCardExpiry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "merchantPaymentId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'checkout',
    "planId" TEXT NOT NULL,
    "billingInterval" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GEL',
    "status" TEXT NOT NULL DEFAULT 'created',
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "requestedPlanId" TEXT,
    "requestedBillingInterval" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUsername" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousValue" JSONB,
    "nextValue" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnualProductionUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productionYear" INTEGER NOT NULL,
    "litersProcessed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'derived_lots',
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnnualProductionUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationSubscription_organizationId_key" ON "OrganizationSubscription"("organizationId");
CREATE INDEX "OrganizationSubscription_status_renewsAt_idx" ON "OrganizationSubscription"("status", "renewsAt");
CREATE UNIQUE INDEX "BillingPayment_providerPaymentId_key" ON "BillingPayment"("providerPaymentId");
CREATE UNIQUE INDEX "BillingPayment_merchantPaymentId_key" ON "BillingPayment"("merchantPaymentId");
CREATE UNIQUE INDEX "BillingPayment_idempotencyKey_key" ON "BillingPayment"("idempotencyKey");
CREATE INDEX "BillingPayment_organizationId_createdAt_idx" ON "BillingPayment"("organizationId", "createdAt");
CREATE INDEX "BillingPayment_status_createdAt_idx" ON "BillingPayment"("status", "createdAt");
CREATE INDEX "SubscriptionRequest_organizationId_status_createdAt_idx" ON "SubscriptionRequest"("organizationId", "status", "createdAt");
CREATE INDEX "SubscriptionRequest_status_createdAt_idx" ON "SubscriptionRequest"("status", "createdAt");
CREATE INDEX "SubscriptionAudit_organizationId_createdAt_idx" ON "SubscriptionAudit"("organizationId", "createdAt");
CREATE UNIQUE INDEX "AnnualProductionUsage_organizationId_productionYear_key" ON "AnnualProductionUsage"("organizationId", "productionYear");
CREATE INDEX "AnnualProductionUsage_productionYear_litersProcessed_idx" ON "AnnualProductionUsage"("productionYear", "litersProcessed");

ALTER TABLE "OrganizationSubscription" ADD CONSTRAINT "OrganizationSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionRequest" ADD CONSTRAINT "SubscriptionRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionAudit" ADD CONSTRAINT "SubscriptionAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnualProductionUsage" ADD CONSTRAINT "AnnualProductionUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
