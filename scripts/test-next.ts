#!/usr/bin/env npx tsx
/**
 * Test /next command locally without Telegram
 *
 * Usage:
 *   npx tsx scripts/test-next.ts           # use carousel skill (fast)
 *   npx tsx scripts/test-next.ts --limit=5 # only show top 5
 *   npx tsx scripts/test-next.ts --high    # only high momentum
 *   npx tsx scripts/test-next.ts --card    # use AI card generator (slower)
 *   npx tsx scripts/test-next.ts --verbose # show more details
 */

import 'dotenv/config';
import { nextSkill, type NextSkillInput } from '../lib/skills/next/index.js';
import { createSkillContext } from '../lib/skills/_shared/context.js';
import { getAnthropicClient } from '../lib/core/config.js';
import { GitHubClient } from '../lib/core/github.js';
import { stateManager } from '../lib/core/state.js';
import { getNextCard } from '../lib/card-generator.js';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const useCard = args.includes('--card');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
const minMomentum = args.includes('--high') ? 'high' as const
  : args.includes('--medium') ? 'medium' as const
  : undefined;

async function testCarouselSkill() {
  console.log(`=== Testing next skill${limit ? ` (limit=${limit})` : ''}${minMomentum ? ` (min=${minMomentum})` : ''} ===\n`);

  const ctx = createSkillContext(undefined, {
    onProgress: async (step, detail) => {
      console.log(`  → ${step}${detail ? ` (${detail})` : ''}`);
    },
  });

  const input: NextSkillInput = {
    limit,
    minMomentum,
  };

  const start = Date.now();
  const result = await nextSkill.run(input, ctx);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!result.success) {
    console.error(`\n❌ Failed: ${result.error}`);
    process.exit(1);
  }

  const { candidates, totalActive, firstCardMessage, noProjectsMessage } = result.data!;

  console.log(`\n✓ Found ${candidates.length} candidates from ${totalActive} active repos in ${elapsed}s\n`);

  if (candidates.length === 0) {
    console.log(noProjectsMessage || 'No projects found.');
    return;
  }

  // Show first card
  if (firstCardMessage) {
    console.log('=== FIRST CARD ===\n');
    console.log(firstCardMessage);
    console.log();
  }

  // List all candidates
  console.log('=== ALL CANDIDATES ===\n');
  const momentumEmoji = { high: '🔥', medium: '⚡', low: '💤' };

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const emoji = momentumEmoji[c.momentum];
    const verdict = c.repo.analysis?.verdict || 'unknown';
    console.log(`${i + 1}. ${emoji} ${c.repo.name} (score: ${c.score})`);
    console.log(`   Verdict: ${verdict} | Days since commit: ${c.daysSinceCommit}`);
    console.log(`   Reason: ${c.reason}`);
    console.log();
  }
}

async function testCardGenerator() {
  console.log('=== Testing /next AI card generator ===\n');

  // Check env
  const required = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'KV_REST_API_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('Missing env vars:', missing.join(', '));
    process.exit(1);
  }
  console.log('✓ Environment configured\n');

  // Load repos from state
  console.log('Loading tracked repos...');
  const repos = await stateManager.getAllTrackedRepos();
  console.log(`✓ Found ${repos.length} repos\n`);

  if (repos.length === 0) {
    console.log('No repos tracked. Run /scan first.');
    process.exit(0);
  }

  // Show repo summary
  if (verbose) {
    console.log('Repos by state:');
    const byState = repos.reduce((acc, r) => {
      acc[r.state] = (acc[r.state] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    Object.entries(byState).forEach(([state, count]) => {
      console.log(`  ${state}: ${count}`);
    });
    console.log();
  }

  // Get next card
  console.log('Generating next card...\n');
  const startTime = Date.now();

  const onProgress = async (progress: { step: string; repoName?: string; stage?: string; potential?: string }) => {
    if (verbose) {
      console.log(`  [${progress.step}]`, progress.repoName || '', progress.potential?.slice(0, 50) || '');
    }
  };

  const card = await getNextCard(
    getAnthropicClient(),
    new GitHubClient(process.env.GITHUB_TOKEN!),
    repos,
    onProgress
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Output result
  if (!card) {
    console.log('Result: No card returned (all caught up)\n');
    console.log(`Time: ${elapsed}s`);
    return;
  }

  console.log('=== CARD OUTPUT ===\n');
  console.log(`Repo:     ${card.full_name}`);
  console.log(`Stage:    ${card.stage}`);
  console.log(`Cover:    ${card.cover_image_url || '(none)'}`);
  console.log(`Homepage: ${card.homepage || '(none)'}`);
  console.log();
  console.log(`Potential: "${card.potential.potential}"`);
  console.log(`ICP:       ${card.potential.icp}`);
  console.log();
  console.log(`Last:     ${card.last_context.last_context}`);
  console.log(`Next:     ${card.next_step.action}`);
  console.log(`Why now:  ${card.next_step.why_this_now}`);
  console.log(`Artifact: ${card.next_step.artifact.type}`);

  if (card.next_step.blocking_question) {
    console.log(`\n⚠️  Blocking: ${card.next_step.blocking_question}`);
  }

  console.log(`\nTime: ${elapsed}s`);
  console.log('==================\n');

  // Full JSON if verbose
  if (verbose) {
    console.log('Full card JSON:');
    console.log(JSON.stringify(card, null, 2));
  }
}

async function main() {
  if (useCard) {
    await testCardGenerator();
  } else {
    await testCarouselSkill();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
