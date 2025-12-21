#!/usr/bin/env npx tsx
/**
 * Test /repo (repository analysis) locally
 *
 * Usage:
 *   npx tsx scripts/test-repo.ts owner/repo
 *   npx tsx scripts/test-repo.ts owner/repo --refresh  # force re-analysis
 *   npx tsx scripts/test-repo.ts owner/repo --details  # show full details
 */

import 'dotenv/config';
import { repoSkill, type RepoSkillInput } from '../lib/skills/repo/index.js';
import { createSkillContext } from '../lib/skills/_shared/context.js';

const args = process.argv.slice(2);
const repoArg = args.find(a => a.includes('/'));
const refresh = args.includes('--refresh');
const showDetails = args.includes('--details');

async function main() {
  if (!repoArg) {
    console.log('Usage: npx tsx scripts/test-repo.ts owner/repo [--refresh] [--details]');
    console.log('\nExamples:');
    console.log('  npx tsx scripts/test-repo.ts vercel/next.js');
    console.log('  npx tsx scripts/test-repo.ts myuser/myrepo --refresh');
    process.exit(1);
  }

  const [owner, name] = repoArg.split('/');
  console.log(`=== Testing repo skill for ${owner}/${name} ===\n`);

  // Create skill context with progress
  const ctx = createSkillContext(undefined, {
    onProgress: async (step, detail) => {
      console.log(`  → ${step}${detail ? ` (${detail})` : ''}`);
    },
  });

  // Run repo skill
  console.log('Running repo skill...');
  const start = Date.now();

  const input: RepoSkillInput = {
    owner,
    name,
    forceRefresh: refresh,
  };

  const result = await repoSkill.run(input, ctx);

  if (!result.success) {
    console.error(`\n❌ Failed: ${result.error}`);
    process.exit(1);
  }

  const { analysis, trackedRepo, cardMessage, detailsMessage, cached } = result.data!;
  const duration = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n✓ Analysis complete in ${duration}s${cached ? ' (cached)' : ''}\n`);

  // Display card
  console.log('=== CARD ===\n');
  console.log(cardMessage);

  // Display analysis summary
  console.log('\n=== ANALYSIS ===\n');
  console.log(`Verdict: ${analysis.verdict.toUpperCase()}`);
  console.log(`One-liner: ${analysis.one_liner}`);
  console.log(`Has Core: ${analysis.has_core}`);
  if (analysis.core_value) {
    console.log(`Core Value: ${analysis.core_value}`);
  }
  console.log(`What it does: ${analysis.what_it_does}`);
  console.log(`Pride Level: ${analysis.pride_level}`);

  if (analysis.cut.length > 0) {
    console.log(`\nCut List (${analysis.cut.length} files):`);
    analysis.cut.slice(0, 5).forEach(f => console.log(`  - ${f}`));
    if (analysis.cut.length > 5) {
      console.log(`  ... and ${analysis.cut.length - 5} more`);
    }
  }

  if (analysis.pride_blockers?.length) {
    console.log(`\nBlockers (${analysis.pride_blockers.length}):`);
    analysis.pride_blockers.forEach(b => console.log(`  - ${b}`));
  }

  if (analysis.shareable_angle) {
    console.log(`\nShareable Angle: ${analysis.shareable_angle}`);
  }

  // Show full details if requested
  if (showDetails) {
    console.log('\n=== DETAILS ===\n');
    console.log(detailsMessage);
  }

  // Show tweet draft if available
  if (analysis.tweet_draft) {
    console.log('\n=== TWEET DRAFT ===\n');
    console.log(analysis.tweet_draft);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
