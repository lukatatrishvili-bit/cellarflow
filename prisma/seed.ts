import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function main() {
  const dbPath = path.resolve(__dirname, '../db.json');
  if (!fs.existsSync(dbPath)) {
    console.log('No db.json found to seed from.');
    return;
  }

  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  console.log(`Seeding database from ${dbPath}...`);

  for (const u of db.users || []) {
    console.log(`Seeding user: ${u.username}`);

    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: {
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        language: u.language || 'en',
        passwordHash: u.passwordHash,
        emailVerified: u.emailVerified ?? false,
        verifyTokenHash: u.verifyTokenHash || null,
        verifyTokenExpires: u.verifyTokenExpires ? BigInt(u.verifyTokenExpires) : null,
        isDemo: u.isDemo ?? false,
      },
      create: {
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        language: u.language || 'en',
        passwordHash: u.passwordHash,
        emailVerified: u.emailVerified ?? false,
        verifyTokenHash: u.verifyTokenHash || null,
        verifyTokenExpires: u.verifyTokenExpires ? BigInt(u.verifyTokenExpires) : null,
        isDemo: u.isDemo ?? false,
      },
    });

    const userData = db.orgData?.[u.activeOrganizationId] || db.userData?.[u.username] || {};
    const cp = userData.companyProfile || {};
    const orgName = cp.wineryName || cp.companyName || `${user.fullName}'s Estate`;

    // Create a default organization for the user
    let org = await prisma.organization.findFirst({
      where: {
        memberships: {
          some: {
            userId: user.username
          }
        }
      }
    });

    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: orgName,
        }
      });

      // Create membership
      await prisma.membership.create({
        data: {
          userId: user.username,
          organizationId: org.id,
          role: 'Owner/Admin'
        }
      });
    }

    // Seed Company Profile linked to the Organization
    await prisma.companyProfile.upsert({
      where: { organizationId: org.id },
      update: {
        companyName: cp.companyName || "",
        wineryName: cp.wineryName || "",
        country: cp.country || "",
        region: cp.region || "",
        municipality: cp.municipality || "",
        address: cp.address || "",
        contactEmail: cp.contactEmail || "",
        phone: cp.phone || "",
        website: cp.website || "",
        measurementUnits: cp.measurementUnits || "metric",
        currency: cp.currency || "GEL",
        latitude: typeof cp.latitude === 'number' ? cp.latitude : null,
        longitude: typeof cp.longitude === 'number' ? cp.longitude : null,
      },
      create: {
        organizationId: org.id,
        companyName: cp.companyName || "",
        wineryName: cp.wineryName || "",
        country: cp.country || "",
        region: cp.region || "",
        municipality: cp.municipality || "",
        address: cp.address || "",
        contactEmail: cp.contactEmail || "",
        phone: cp.phone || "",
        website: cp.website || "",
        measurementUnits: cp.measurementUnits || "metric",
        currency: cp.currency || "GEL",
        latitude: typeof cp.latitude === 'number' ? cp.latitude : null,
        longitude: typeof cp.longitude === 'number' ? cp.longitude : null,
      },
    });

    await prisma.organizationState.upsert({
      where: { organizationId: org.id },
      update: {
        data: userData,
        version: { increment: 1 },
        updatedBy: 'prisma-seed',
      },
      create: {
        organizationId: org.id,
        data: userData,
        version: 1,
        updatedBy: 'prisma-seed',
      },
    });

    const seedCollection = async (model: any, items: any[]) => {
      if (!items || items.length === 0) return;
      await model.deleteMany({ where: { organizationId: org.id } });
      const data = items.map((item: any) => {
        const copy = { ...item, organizationId: org.id };
        return copy;
      });
      await model.createMany({ data });
    };

    await seedCollection(prisma.vessel, userData.vessels);
    await seedCollection(prisma.wineLot, userData.lots);
    await seedCollection(prisma.dailyFermLog, userData.fermlogs);
    await seedCollection(prisma.labAnalysis, userData.lablogs);
    await seedCollection(prisma.inventoryItem, userData.inventory);
    await seedCollection(prisma.task, userData.tasks);
    await seedCollection(prisma.note, userData.notes);
    await seedCollection(prisma.vineyardBlock, userData.blocks);
    await seedCollection(prisma.vineyardPlantingProject, userData.vineyardProjects);
    await seedCollection(prisma.phenologyRecord, userData.phenologyLogs);
    await seedCollection(prisma.sprayRecord, userData.sprays);
    await seedCollection(prisma.scoutingRecord, userData.scoutings);
    await seedCollection(prisma.soilAnalysisRecord, userData.soilRecords);
    await seedCollection(prisma.grapeSamplingRecord, userData.samplings);
    await seedCollection(prisma.harvestRecord, userData.harvests);
    await seedCollection(prisma.irrigationRecord, userData.irrigationLogs);
    await seedCollection(prisma.fertilizationRecord, userData.fertilizerLogs);
    await seedCollection(prisma.auditLog, userData.auditLogs);
    await seedCollection(prisma.bottlingRun, userData.bottlingRuns);
    await seedCollection(prisma.transfer, userData.transfers);
    await seedCollection(prisma.grapeIntake, userData.grapeIntakes);
    await seedCollection(prisma.cellarOp, userData.cellarOps);
    await seedCollection(prisma.costEntry, userData.costEntries);
    await seedCollection(prisma.storageLocation, userData.storageLocations);
    await seedCollection(prisma.stockMovement, userData.stockMovements);
    await seedCollection(prisma.salesDispatch, userData.salesDispatches);
    await seedCollection(prisma.salesOrder, userData.salesOrders);
  }

  console.log('Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
