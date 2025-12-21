#!/usr/bin/env npx tsx
/**
 * Test /preview (cover image generation) locally
 *
 * Usage:
 *   npx tsx scripts/test-preview.ts owner/repo
 *   npx tsx scripts/test-preview.ts owner/repo --save    # save to disk
 *   npx tsx scripts/test-preview.ts owner/repo --upload  # upload to GitHub
 *   npx tsx scripts/test-preview.ts owner/repo "feedback" # with feedback
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { stateManager } from '../lib/core/state.js';
import { GitHubClient } from '../lib/core/github.js';
import { previewSkill, uploadSkill } from '../lib/skills/preview/index.js';
import { createSkillContext } from '../lib/skills/_shared/context.js';

const args = process.argv.slice(2);
const repoArg = args.find(a => a.includes('/'));
const save = args.includes('--save');
const upload = args.includes('--upload');
const feedback = args.find(a => !a.startsWith('--') && !a.includes('/'));

async function main() {
  if (!repoArg) {
    console.log('Usage: npx tsx scripts/test-preview.ts owner/repo [--save] [--upload] ["feedback"]');
    process.exit(1);
  }

  const [owner, name] = repoArg.split('/');
  console.log(`=== Testing preview skill for ${owner}/${name} ===\n`);

  // Create skill context with progress
  const ctx = createSkillContext(undefined, {
    onProgress: async (step, detail) => {
      console.log(`  → ${step}${detail ? ` (${detail})` : ''}`);
    },
  });

  // Check for existing analysis
  const tracked = await stateManager.getTrackedRepo(owner, name);

  if (tracked?.analysis) {
    console.log(`Using cached analysis: "${tracked.analysis.one_liner}"`);
    console.log(`Verdict: ${tracked.analysis.verdict}\n`);
  } else {
    console.log('No analysis cached, fetching GitHub metadata...');
    const github = new GitHubClient(process.env.GITHUB_TOKEN!);
    const repoInfo = await github.getRepoInfo(owner, name);

    if (!repoInfo) {
      console.error('Could not fetch repo info');
      process.exit(1);
    }

    console.log(`Description: ${repoInfo.description || '(none)'}`);
    console.log(`Language: ${repoInfo.language || 'unknown'}\n`);
  }

  // Run preview skill
  console.log('Running preview skill...');
  const start = Date.now();

  const github = new GitHubClient(process.env.GITHUB_TOKEN!);
  const repoInfo = await github.getRepoInfo(owner, name);

  const result = await previewSkill.run({
    owner,
    name,
    trackedRepo: tracked || undefined,
    repoInfo: repoInfo ? {
      name,
      description: repoInfo.description,
      language: repoInfo.language,
    } : undefined,
    feedback: feedback ? [feedback] : [],
  }, ctx);

  if (!result.success) {
    console.error(`\n❌ Failed: ${result.error}`);
    process.exit(1);
  }

  const { imageBuffer } = result.data!;
  console.log(`\n✓ Generated in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`Image size: ${(imageBuffer.length / 1024).toFixed(1)} KB\n`);

  // Save locally
  if (save) {
    const filename = `${name}-cover.png`;
    writeFileSync(filename, imageBuffer);
    console.log(`✓ Saved to ${filename}`);
  }

  // Upload to GitHub using upload skill
  if (upload) {
    console.log('Running upload skill...');
    const uploadResult = await uploadSkill.run({ owner, name, imageBuffer }, ctx);

    if (uploadResult.success) {
      console.log(`✓ Uploaded to .github/social-preview.png`);
      console.log(`  URL: ${uploadResult.data!.imageUrl}`);
      if (uploadResult.data!.result.readmeUpdated) {
        console.log(`  README updated with header`);
      }
    } else {
      console.log(`❌ Upload failed: ${uploadResult.error}`);
    }
  }

  if (!save && !upload) {
    console.log('Tip: Use --save to write to disk, --upload to push to GitHub');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
