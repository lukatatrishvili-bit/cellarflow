-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "passwordHash" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifyTokenHash" TEXT,
    "verifyTokenExpires" BIGINT,
    "resetTokenHash" TEXT,
    "resetTokenExpires" BIGINT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "activeOrganizationId" TEXT,
    "enabledModules" JSONB,
    "enabledWidgets" JSONB,
    "registrationComplete" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationState" (
    "organizationId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationState_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstAt" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT '',
    "wineryName" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "municipality" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "measurementUnits" TEXT NOT NULL DEFAULT 'metric',
    "currency" TEXT NOT NULL DEFAULT 'GEL',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vessel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "capacity" DOUBLE PRECISION NOT NULL,
    "currentVolume" DOUBLE PRECISION NOT NULL,
    "assignedLotId" TEXT,
    "cleaningStatus" TEXT NOT NULL,
    "lastCleaned" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "coolingJacketActive" BOOLEAN NOT NULL,
    "targetTemperature" DOUBLE PRECISION,
    "lastOperation" TEXT NOT NULL,
    "locationDetails" TEXT,
    "xGrid" INTEGER,
    "yGrid" INTEGER,
    "lastSealedDate" TEXT,
    "soilTemperature" DOUBLE PRECISION,
    "qvevriNumber" TEXT,
    "maraniLocation" TEXT,
    "buried" BOOLEAN,
    "lastWashingDate" TEXT,
    "limeWashStatus" TEXT,
    "waxingStatus" TEXT,
    "inspectionNotes" TEXT,
    "fillingDate" TEXT,
    "grapeVariety" TEXT,
    "chachaPercentage" DOUBLE PRECISION,
    "stemInclusion" BOOLEAN,
    "mixingFrequency" TEXT,
    "dailyMixingLog" JSONB NOT NULL DEFAULT '[]',
    "sealingDate" TEXT,
    "openingDate" TEXT,
    "skinContactDurationDays" INTEGER,
    "firstRackingDate" TEXT,
    "sanitationHistory" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "Vessel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WineLot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vintage" INTEGER NOT NULL,
    "variety" TEXT NOT NULL,
    "vineyardBlock" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "initialVolume" DOUBLE PRECISION NOT NULL,
    "currentVolume" DOUBLE PRECISION NOT NULL,
    "wineClass" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "sensoryProfile" JSONB,

    CONSTRAINT "WineLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyFermLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "density" DOUBLE PRECISION NOT NULL,
    "sugar" DOUBLE PRECISION NOT NULL,
    "ph" DOUBLE PRECISION NOT NULL,
    "tastingNotes" TEXT NOT NULL,
    "capManagement" TEXT NOT NULL,
    "additives" TEXT NOT NULL,

    CONSTRAINT "DailyFermLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabAnalysis" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "alcoholPct" DOUBLE PRECISION NOT NULL,
    "volatileAcid" DOUBLE PRECISION NOT NULL,
    "freeSo2" DOUBLE PRECISION NOT NULL,
    "totalSo2" DOUBLE PRECISION NOT NULL,
    "residualSugar" DOUBLE PRECISION NOT NULL,
    "ph" DOUBLE PRECISION NOT NULL,
    "malicAcid" DOUBLE PRECISION NOT NULL,
    "lacticAcid" DOUBLE PRECISION NOT NULL,
    "turbidity" DOUBLE PRECISION NOT NULL,
    "technician" TEXT NOT NULL,
    "titratableAcidity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "LabAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "safetyStock" DOUBLE PRECISION NOT NULL,
    "lastReorder" TEXT,
    "supplier" TEXT,
    "costPerUnit" DOUBLE PRECISION NOT NULL,
    "location" TEXT,
    "notes" TEXT,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "assignedTo" TEXT,
    "status" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "lastModified" TEXT NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VineyardBlock" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vineyardName" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "cadastralCode" TEXT,
    "officialCadastreDocumentName" TEXT,
    "landOwner" TEXT,
    "grower" TEXT,
    "municipality" TEXT,
    "community" TEXT,
    "village" TEXT,
    "microzone" TEXT,
    "parcelName" TEXT,
    "parcelArea" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "area" DOUBLE PRECISION NOT NULL,
    "elevation" DOUBLE PRECISION NOT NULL,
    "slope" TEXT NOT NULL,
    "aspect" TEXT NOT NULL,
    "soilType" TEXT NOT NULL,
    "grapeVariety" TEXT NOT NULL,
    "clone" TEXT,
    "rootstock" TEXT,
    "plantingYear" INTEGER NOT NULL,
    "spacing" TEXT NOT NULL,
    "rowsCount" INTEGER NOT NULL,
    "vinesCount" INTEGER NOT NULL,
    "trainingSystem" TEXT NOT NULL,
    "pruningSystem" TEXT NOT NULL,
    "irrigationEnabled" BOOLEAN NOT NULL,
    "farmingStatus" TEXT NOT NULL,
    "currentPhenology" TEXT NOT NULL,
    "estimatedHarvestDate" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "boundary" JSONB,
    "gpsPolygon" JSONB,
    "vineyardCondition" TEXT,

    CONSTRAINT "VineyardBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VineyardPlantingProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "landOwnershipDocumentName" TEXT,
    "cadastralMapDocumentName" TEXT,
    "soilAnalysisDocumentName" TEXT,
    "agrotechnicalQuestionnaireName" TEXT,
    "plannedVarieties" JSONB NOT NULL DEFAULT '[]',
    "rootstock" TEXT,
    "spacing" TEXT,
    "rowDirection" TEXT,
    "irrigationPlan" TEXT,
    "nurseryInvoiceDocumentName" TEXT,
    "applicationStatus" TEXT NOT NULL,
    "approvalDate" TEXT,
    "approvalValidUntil" TEXT,
    "soilDepth" DOUBLE PRECISION,
    "pH" DOUBLE PRECISION,
    "organicMatter" DOUBLE PRECISION,
    "caco3" DOUBLE PRECISION,
    "texture" TEXT,
    "ec" DOUBLE PRECISION,
    "exchangeableCa" DOUBLE PRECISION,
    "exchangeableMg" DOUBLE PRECISION,
    "exchangeableNa" DOUBLE PRECISION,
    "hygroscopicWater" DOUBLE PRECISION,

    CONSTRAINT "VineyardPlantingProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhenologyRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "gdd" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "observer" TEXT NOT NULL,

    CONSTRAINT "PhenologyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SprayRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "targetProblem" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "activeIngredient" TEXT NOT NULL,
    "dosePerHa" DOUBLE PRECISION NOT NULL,
    "waterVolumePerHa" DOUBLE PRECISION NOT NULL,
    "totalProductUsed" DOUBLE PRECISION NOT NULL,
    "totalWaterUsed" DOUBLE PRECISION NOT NULL,
    "operator" TEXT NOT NULL,
    "machineryUsed" TEXT NOT NULL,
    "windSpeed" DOUBLE PRECISION NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "humidity" DOUBLE PRECISION NOT NULL,
    "preHarvestIntervalDays" INTEGER NOT NULL,
    "reEntryIntervalHours" INTEGER NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "SprayRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoutingRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "locationDetails" TEXT NOT NULL,
    "problemType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "followUpTaskId" TEXT,

    CONSTRAINT "ScoutingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoilAnalysisRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "pH" DOUBLE PRECISION NOT NULL,
    "organicMatterPct" DOUBLE PRECISION NOT NULL,
    "nitrogenMgKg" DOUBLE PRECISION NOT NULL,
    "phosphorusMgKg" DOUBLE PRECISION NOT NULL,
    "potassiumMgKg" DOUBLE PRECISION NOT NULL,
    "calciumMgKg" DOUBLE PRECISION NOT NULL,
    "magnesiumMgKg" DOUBLE PRECISION NOT NULL,
    "salinityDsm" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "SoilAnalysisRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrapeSamplingRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "brix" DOUBLE PRECISION NOT NULL,
    "pH" DOUBLE PRECISION NOT NULL,
    "totalAcidityGL" DOUBLE PRECISION NOT NULL,
    "berryWeightG" DOUBLE PRECISION NOT NULL,
    "phenolicMaturity" TEXT NOT NULL,
    "seedColor" TEXT NOT NULL,
    "tasteNotes" TEXT NOT NULL,
    "diseaseCondition" TEXT NOT NULL,
    "estimatedHarvestDate" TEXT NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "GrapeSamplingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarvestRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "variety" TEXT NOT NULL,
    "estimatedHarvestDate" TEXT NOT NULL,
    "estimatedTons" DOUBLE PRECISION NOT NULL,
    "actualHarvestDate" TEXT,
    "actualHarvestedKg" DOUBLE PRECISION,
    "pickingMethod" TEXT NOT NULL,
    "grapeCondition" TEXT NOT NULL,
    "sentToGvino" BOOLEAN NOT NULL,
    "associatedLotId" TEXT,
    "notes" TEXT NOT NULL,

    CONSTRAINT "HarvestRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IrrigationRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "durationHours" DOUBLE PRECISION NOT NULL,
    "waterVolumeLiters" DOUBLE PRECISION NOT NULL,
    "soilMoistureBeforePct" DOUBLE PRECISION NOT NULL,
    "soilMoistureAfterPct" DOUBLE PRECISION NOT NULL,
    "weatherConditions" TEXT NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "IrrigationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FertilizationRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "dosePerHa" DOUBLE PRECISION NOT NULL,
    "totalAmountUsed" DOUBLE PRECISION NOT NULL,
    "applicationMethod" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "FertilizationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "operator" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BottlingRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "bottleSize" TEXT NOT NULL,
    "bottlesCount" INTEGER NOT NULL,
    "totalVolume" DOUBLE PRECISION NOT NULL,
    "closureType" TEXT NOT NULL,
    "labelDesign" TEXT,
    "qaPassed" BOOLEAN NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "BottlingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "sourceTankId" TEXT NOT NULL,
    "destTankId" TEXT NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "lossVolume" DOUBLE PRECISION NOT NULL,
    "purpose" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrapeIntake" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "variety" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "brix" DOUBLE PRECISION NOT NULL,
    "ph" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "associatedLot" TEXT NOT NULL,

    CONSTRAINT "GrapeIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CellarOp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "CellarOp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "lotId" TEXT,
    "source" TEXT NOT NULL,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "capacity" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,

    CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "reference" TEXT,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDispatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,

    CONSTRAINT "SalesDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_organizationId_key" ON "CompanyProfile"("organizationId");

-- AddForeignKey
ALTER TABLE "OrganizationState" ADD CONSTRAINT "OrganizationState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("username") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vessel" ADD CONSTRAINT "Vessel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WineLot" ADD CONSTRAINT "WineLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyFermLog" ADD CONSTRAINT "DailyFermLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAnalysis" ADD CONSTRAINT "LabAnalysis_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VineyardBlock" ADD CONSTRAINT "VineyardBlock_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VineyardPlantingProject" ADD CONSTRAINT "VineyardPlantingProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhenologyRecord" ADD CONSTRAINT "PhenologyRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprayRecord" ADD CONSTRAINT "SprayRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutingRecord" ADD CONSTRAINT "ScoutingRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilAnalysisRecord" ADD CONSTRAINT "SoilAnalysisRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrapeSamplingRecord" ADD CONSTRAINT "GrapeSamplingRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HarvestRecord" ADD CONSTRAINT "HarvestRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IrrigationRecord" ADD CONSTRAINT "IrrigationRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FertilizationRecord" ADD CONSTRAINT "FertilizationRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BottlingRun" ADD CONSTRAINT "BottlingRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrapeIntake" ADD CONSTRAINT "GrapeIntake_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CellarOp" ADD CONSTRAINT "CellarOp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDispatch" ADD CONSTRAINT "SalesDispatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
