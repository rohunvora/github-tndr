#!/usr/bin/env npx tsx
/**
 * Test chart analysis skill locally
 *
 * Usage:
 *   npx tsx scripts/test-chart.ts path/to/chart.png
 *   npx tsx scripts/test-chart.ts path/to/chart.png --save     # save annotated image
 *   npx tsx scripts/test-chart.ts path/to/chart.png --mock     # use mock context (no API)
 *   npx tsx scripts/test-chart.ts path/to/chart.png "What's the support?" # custom question
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { basename, dirname, join } from 'path';
import { chartSkill, type ChartSkillInput } from '../lib/skills/chart/index.js';
import { createSkillContext, createTestContext } from '../lib/skills/_shared/context.js';

const args = process.argv.slice(2);
const imagePath = args.find(a => !a.startsWith('--') && (a.endsWith('.png') || a.endsWith('.jpg') || a.endsWith('.jpeg')));
const save = args.includes('--save');
const useMock = args.includes('--mock');
const question = args.find(a => !a.startsWith('--') && a !== imagePath);

async function main() {
  if (!imagePath) {
    console.log('Usage: npx tsx scripts/test-chart.ts path/to/chart.png [--save] [--mock] ["question"]');
    console.log('\nExamples:');
    console.log('  npx tsx scripts/test-chart.ts ~/chart.png');
    console.log('  npx tsx scripts/test-chart.ts ~/chart.png --save');
    console.log('  npx tsx scripts/test-chart.ts ~/chart.png "Where is support?"');
    process.exit(1);
  }

  if (!existsSync(imagePath)) {
    console.error(`File not found: ${imagePath}`);
    process.exit(1);
  }

  console.log(`=== Testing chart skill ===\n`);
  console.log(`Image: ${imagePath}`);
  if (question) console.log(`Question: "${question}"`);
  console.log(`Mode: ${useMock ? 'mock (no API calls)' : 'live (real API)'}\n`);

  // Read image
  const imageBuffer = readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');
  console.log(`Image size: ${(imageBase64.length / 1024).toFixed(1)} KB\n`);

  // Create context
  const ctx = useMock
    ? createTestContext()
    : createSkillContext(undefined, {
        onProgress: async (step, detail) => {
          console.log(`  → ${step}${detail ? ` (${detail})` : ''}`);
        },
      });

  // Run skill
  console.log('Running chart analysis...');
  const start = Date.now();

  const input: ChartSkillInput = {
    imageBase64,
    question,
  };

  const result = await chartSkill.run(input, ctx);
  const duration = ((Date.now() - start) / 1000).toFixed(1);

  if (!result.success) {
    console.error(`\n❌ Failed: ${result.error}`);
    process.exit(1);
  }

  const { analysis, annotatedImage, caption } = result.data!;

  console.log(`\n✓ Analysis complete in ${duration}s\n`);

  // Display analysis
  console.log('=== ANALYSIS ===\n');
  console.log(`Caption: ${caption}`);
  console.log(`Symbol: ${analysis.symbol || '(not detected)'}`);
  console.log(`Timeframe: ${analysis.timeframe || '(not detected)'}`);
  console.log(`Current Price: $${analysis.currentPrice}`);
  console.log(`Regime: ${analysis.regime.type} (${(analysis.regime.confidence * 100).toFixed(0)}% confidence)`);

  console.log('\n--- Story ---');
  console.log(analysis.story);

  console.log('\n--- Current Context ---');
  console.log(analysis.currentContext);

  console.log('\n--- Key Zones ---');
  for (const zone of analysis.keyZones) {
    const strength = zone.strength === 'strong' ? '★★★' : zone.strength === 'moderate' ? '★★' : '★';
    const color = zone.type === 'support' ? '🟢' : '🔴';
    console.log(`  ${color} $${zone.price} - ${zone.label} ${strength}`);
    console.log(`     ${zone.significance}`);
  }

  console.log('\n--- Scenarios ---');
  for (const scenario of analysis.scenarios) {
    console.log(`  • ${scenario.condition}`);
    console.log(`    → ${scenario.implication}`);
  }

  console.log('\n--- Invalidation ---');
  console.log(`  ${analysis.invalidation}`);

  // Optional patterns
  if (analysis.rangeBox) {
    console.log('\n--- Range Box ---');
    console.log(`  High: $${analysis.rangeBox.high} | Low: $${analysis.rangeBox.low}`);
  }

  if (analysis.pivots?.points.length) {
    console.log('\n--- Pivots ---');
    for (const p of analysis.pivots.points) {
      console.log(`  ${p.label}: $${p.price}`);
    }
  }

  if (analysis.fakeouts?.length) {
    console.log('\n--- Fakeouts ---');
    for (const f of analysis.fakeouts) {
      console.log(`  $${f.level} (${f.direction})`);
    }
  }

  // Save annotated image
  if (save && annotatedImage) {
    const dir = dirname(imagePath);
    const base = basename(imagePath, '.png').replace('.jpg', '').replace('.jpeg', '');
    const outputPath = join(dir, `${base}-annotated.png`);
    const outputBuffer = Buffer.from(annotatedImage, 'base64');
    writeFileSync(outputPath, outputBuffer);
    console.log(`\n✓ Saved annotated image to ${outputPath}`);
    console.log(`  Size: ${(outputBuffer.length / 1024).toFixed(1)} KB`);
  } else if (save && !annotatedImage) {
    console.log('\n⚠ No annotated image to save (annotation may have failed)');
  } else if (annotatedImage) {
    console.log(`\nTip: Use --save to write annotated image to disk`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
