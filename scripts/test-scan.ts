#!/usr/bin/env npx tsx
/**
 * Test /scan command locally without Telegram
 *
 * Usage:
 *   npx tsx scripts/test-scan.ts           # scan last 10 days
 *   npx tsx scripts/test-scan.ts 30        # scan last 30 days
 *   npx tsx scripts/test-scan.ts --dry-run # show what would be scanned, don't analyze
 *   npx tsx scripts/test-scan.ts --limit=5 # only analyze first 5 repos
 */

import 'dotenv/config';
import { GitHubClient } from '../lib/core/github.js';
import { stateManager } from '../lib/core/state.js';
import { scanSkill, type ScanSkillInput } from '../lib/skills/scan/index.js';
import { createSkillContext } from '../lib/skills/_shared/context.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const days = parseInt(args.find(a => /^\d+$/.test(a)) || '10', 10);
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

async function main() {
  console.log(`=== Testing scan skill (${days} days${dryRun ? ', dry-run' : ''}${limit ? `, limit=${limit}` : ''}) ===\n`);

  const github = new GitHubClient(process.env.GITHUB_TOKEN!);

  // 1. Fetch repos (for dry run)
  console.log(`Fetching repos pushed in last ${days} days...`);
  const repos = await github.getRecentRepos(days);
  console.log(`✓ Found ${repos.length} repos\n`);

  if (repos.length === 0) {
    console.log('No repos found.');
    return;
  }

  // Show repos
  console.log('Repos to scan:');
  for (const repo of repos.slice(0, limit || repos.length)) {
    const [owner, name] = repo.full_name.split('/');
    const tracked = await stateManager.getTrackedRepo(owner, name);
    const status = tracked?.analysis ? `[${tracked.analysis.verdict}]` : '[unanalyzed]';
    console.log(`  ${repo.full_name} ${status}`);
  }
  console.log();

  if (dryRun) {
    console.log('Dry run - skipping analysis');
    return;
  }

  // 2. Run scan skill
  console.log('Running scan skill...');
  const start = Date.now();

  const ctx = createSkillContext(undefined, {
    onProgress: async (step, detail) => {
      console.log(`  → ${step}${detail ? ` (${detail})` : ''}`);
    },
  });

  const input: ScanSkillInput = {
    days,
    limit,
    timeout: 120000, // 2 min for CLI
    onRepoAnalyzed: (repo, index, total) => {
      const verdict = repo.analysis?.verdict || 'unknown';
      const cached = repo.analyzed_at && new Date(repo.analyzed_at).getTime() < start ? ' (cached)' : '';
      console.log(`    [${index}/${total}] ${repo.name}: ${verdict}${cached}`);
    },
  };

  const result = await scanSkill.run(input, ctx);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!result.success) {
    console.error(`\n❌ Failed: ${result.error}`);
    process.exit(1);
  }

  const { groups, verdicts, totalFound, totalAnalyzed, cached, errors, hitTimeout, summaryMessage } = result.data!;

  console.log(`\n✓ Scan complete in ${elapsed}s\n`);

  // Summary
  console.log('=== SUMMARY ===\n');
  console.log(`Total found: ${totalFound}`);
  console.log(`Analyzed: ${totalAnalyzed} (${cached} from cache)`);
  if (hitTimeout) console.log('⚠️ Hit timeout');
  console.log();

  console.log('By verdict:');
  if (verdicts.ship > 0) console.log(`  🟢 Ship: ${verdicts.ship}`);
  if (verdicts.cut > 0) console.log(`  🟡 Cut to Core: ${verdicts.cut}`);
  if (verdicts.no_core > 0) console.log(`  🔴 No Core: ${verdicts.no_core}`);
  if (verdicts.dead > 0) console.log(`  ☠️ Dead: ${verdicts.dead}`);
  if (verdicts.shipped > 0) console.log(`  🚀 Shipped: ${verdicts.shipped}`);

  if (errors.length > 0) {
    console.log(`\n⚠️ Errors (${errors.length}):`);
    errors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
    if (errors.length > 5) console.log(`  ... and ${errors.length - 5} more`);
  }

  // Grouped repos
  if (groups.ship.length > 0) {
    console.log(`\n🟢 Ready to Ship (${groups.ship.length}):`);
    groups.ship.forEach(r => console.log(`  - ${r.name}: ${r.analysis?.one_liner?.slice(0, 60)}...`));
  }

  if (groups.cut.length > 0) {
    console.log(`\n🟡 Cut to Core (${groups.cut.length}):`);
    groups.cut.forEach(r => console.log(`  - ${r.name}: ${r.analysis?.cut.length || 0} files to cut`));
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
