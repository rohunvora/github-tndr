#!/usr/bin/env npx tsx
/**
 * Test /readme command locally without Telegram
 *
 * Usage:
 *   npx tsx scripts/test-readme.ts owner/repo       # generate README
 *   npx tsx scripts/test-readme.ts owner/repo --save # save to file
 *   npx tsx scripts/test-readme.ts repo-name        # use tracked repo
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { readmeSkill, type ReadmeSkillInput } from '../lib/skills/readme/index.js';
import { createSkillContext } from '../lib/skills/_shared/context.js';
import { stateManager } from '../lib/core/state.js';

const args = process.argv.slice(2);
const save = args.includes('--save');
const repoArg = args.find(a => !a.startsWith('--'));

if (!repoArg) {
  console.log('Usage: npx tsx scripts/test-readme.ts owner/repo [--save]');
  process.exit(1);
}

async function main() {
  console.log(`=== Testing readme skill ===\n`);

  // Resolve owner/name
  let owner: string;
  let name: string;

  if (repoArg!.includes('/')) {
    [owner, name] = repoArg!.split('/');
  } else {
    // Try to find by name in tracked repos
    const tracked = await stateManager.getTrackedRepoByName(repoArg!);
    if (!tracked) {
      console.error(`Repo "${repoArg}" not found. Use owner/name format.`);
      process.exit(1);
    }
    owner = tracked.owner;
    name = tracked.name;
  }

  console.log(`Repo: ${owner}/${name}\n`);

  const ctx = createSkillContext(undefined, {
    onProgress: async (step, detail) => {
      console.log(`  → ${step}${detail ? ` (${detail})` : ''}`);
    },
  });

  const input: ReadmeSkillInput = { owner, name };

  const start = Date.now();
  const result = await readmeSkill.run(input, ctx);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!result.success) {
    console.error(`\n❌ Failed: ${result.error}`);
    process.exit(1);
  }

  const { content, preview } = result.data!;

  console.log(`\n✓ README generated in ${elapsed}s (${content.length} chars)\n`);

  // Show preview
  console.log('=== PREVIEW ===\n');
  console.log(preview);
  console.log();

  // Save if requested
  if (save) {
    const outPath = path.join(process.cwd(), `README-${name}.md`);
    fs.writeFileSync(outPath, content);
    console.log(`\n✓ Saved to ${outPath}`);
  } else {
    console.log('(Use --save to save full README to file)');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
