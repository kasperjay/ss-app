#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * seed-sequences.js
 *
 * Seeds the default follow-up sequences if none exist.
 * Safe to run multiple times — idempotent by checking isDefault sequences.
 *
 * Usage:
 *   node scripts/seed-sequences.js
 */

const { prisma } = require("../src/lib/agent-runner");
const { DEFAULT_SEQUENCES } = require("../src/lib/reply-to-close-core");

async function main() {
  console.log("🌱 Seeding follow-up sequences...\n");

  const existing = await prisma.followUpSequence.findMany({
    select: { name: true },
  });

  const existingNames = new Set(existing.map((s) => s.name));

  let created = 0;
  let skipped = 0;

  for (const seq of DEFAULT_SEQUENCES) {
    if (existingNames.has(seq.name)) {
      console.log(`  ⏭  Skipping "${seq.name}" (already exists)`);
      skipped++;
      continue;
    }

    await prisma.followUpSequence.create({ data: seq });
    console.log(
      `  ✓  Created "${seq.name}" (${seq.steps.length} steps, default: ${seq.isDefault})`
    );
    created++;
  }

  console.log(`\n📊 Done. Created: ${created}, Skipped: ${skipped}`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
