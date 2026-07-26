-- Vessel and lot identifiers are human-readable within a winery (for example
-- T-01 and LOT-2026-01), so they must not be globally unique across tenants.
-- Replacing the primary keys is data-preserving: both organizationId columns
-- are already NOT NULL and backed by cascading organization foreign keys.
ALTER TABLE "Vessel" DROP CONSTRAINT "Vessel_pkey";
ALTER TABLE "Vessel"
  ADD CONSTRAINT "Vessel_pkey" PRIMARY KEY ("organizationId", "id");

ALTER TABLE "WineLot" DROP CONSTRAINT "WineLot_pkey";
ALTER TABLE "WineLot"
  ADD CONSTRAINT "WineLot_pkey" PRIMARY KEY ("organizationId", "id");
