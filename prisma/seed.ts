/**
 * Prisma Seed Script
 * 
 * Purpose:
 * This script initializes and updates the database with mandatory base data.
 * It is designed to be idempotent (safe to run multiple times) using upsert operations.
 * 
 * Main Operations:
 * 1. Populates the `payment_provider` catalog from `seed-data/payment-providers.json`.
 * 2. Ensures global configurations and system-level entities are present.
 * 
 * Usage:
 * npx prisma db seed
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seeding...');

  // 1. Seed Payment Providers
  const providersPath = path.join(__dirname, 'seed-data', 'payment-providers.json');
  const providersData = JSON.parse(fs.readFileSync(providersPath, 'utf8'));

  console.log(`Seeding ${providersData.length} payment providers...`);

  for (const provider of providersData) {
    await prisma.payment_provider.upsert({
      where: {
        name_country_code_type: {
          name: provider.name,
          country_code: provider.country_code,
          type: provider.type,
        },
      },
      update: {
        metadata: provider.metadata,
        is_active: true,
      },
      create: {
        name: provider.name,
        type: provider.type,
        country_code: provider.country_code,
        metadata: provider.metadata,
        is_active: true,
      },
    });
  }
  console.log('Seeding completed successfully.');
  console.log('Finished providers seeding.');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
