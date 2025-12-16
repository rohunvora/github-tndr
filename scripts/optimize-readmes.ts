#!/usr/bin/env npx tsx

/**
 * README Optimizer Script
 * 
 * Philosophy: If you can't write a clear launch announcement, the product isn't clear.
 * This script catches up past projects to a "launch-ready" standard by:
 * 1. Finding repos with substance (promise scoring)
 * 2. Analyzing them to extract the core value
 * 3. Generating READMEs that lead with that value
 * 
 * The README becomes the forcing function for clarity.
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { GitHubClient } from '../lib/github.js';
import { RepoAnalyzer } from '../lib/analyzer.js';
import { ReadmeGenerator, ReadmeContext, formatReadmeFilename } from '../lib/readme-generator.js';
import { scoreAndSortRepos, RepoPromiseScore } from '../lib/promise-scorer.js';
import { CoreAnalysis, TrackedRepo } from '../lib/core-types.js';
import { generateRepoCover } from '../lib/nano-banana.js';

// ============ CONFIG ============

const DAYS_BACK = 150;
const MIN_PROMISE_SCORE = 30;
const OUTPUT_DIR = join(process.cwd(), 'output', 'readmes');
const IMAGES_DIR = join(process.cwd(), 'output', 'images');
const INCLUDE_PRIVATE = true; // Include private repos where you're the sole owner

// ============ HELPERS ============

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function logProgress(msg: string) {
  // Inline progress that overwrites itself
  process.stdout.write(`\r[${new Date().toISOString().slice(11, 19)}] ${msg.padEnd(80)}`);
}

function formatScore(score: RepoPromiseScore): string {
  const b = score.breakdown;
  return `${score.score}/100 (files:${b.fileCount} code:${b.codeRatio} activity:${b.activity} readme:${b.readmeQuality} stars:${b.stars})`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ============ MAIN ============

async function main() {
  const scriptStart = Date.now();
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  README Optimizer - Catch up past projects to launch-ready ║
╚════════════════════════════════════════════════════════════╝
`);

  // Validate env
  const githubToken = process.env.GITHUB_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  
  if (!githubToken) {
    console.error('❌ Missing GITHUB_TOKEN in environment');
    process.exit(1);
  }
  if (!anthropicKey) {
    console.error('❌ Missing ANTHROPIC_API_KEY in environment');
    process.exit(1);
  }
  
  log('✅ Environment validated');

  // Initialize clients
  log('Initializing API clients...');
  const github = new GitHubClient(githubToken);
  const analyzer = new RepoAnalyzer(anthropicKey, githubToken);
  const readmeGen = new ReadmeGenerator(anthropicKey);
  log('✅ Clients initialized');

  // Ensure output directories exist
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    log(`📁 Created output directory: ${OUTPUT_DIR}`);
  }
  if (!existsSync(IMAGES_DIR)) {
    mkdirSync(IMAGES_DIR, { recursive: true });
    log(`📁 Created images directory: ${IMAGES_DIR}`);
  }

  // Step 1: Fetch owned repos from last N days (public + private with no collaborators)
  log(`\n📡 Fetching owned repos from last ${DAYS_BACK} days...`);
  log(`   (Including private repos: ${INCLUDE_PRIVATE})`);
  log('   (This calls GitHub API - may take a few seconds)');
  const fetchStart = Date.now();
  const repos = await github.getOwnedRepos(DAYS_BACK, INCLUDE_PRIVATE);
  const publicCount = repos.filter(r => !r.private).length;
  const privateCount = repos.filter(r => r.private).length;
  log(`✅ Found ${repos.length} repos (${publicCount} public, ${privateCount} private) (${formatDuration(Date.now() - fetchStart)})`);

  if (repos.length === 0) {
    log('No repos to process. Done.');
    return;
  }

  // Step 2: Score and sort repos by promise
  log(`\n🔍 Scoring ${repos.length} repos by promise...`);
  log('   (Fetching file trees and commit history for each repo)');
  const scoreStart = Date.now();
  let lastLogTime = Date.now();
  
  const scores = await scoreAndSortRepos(repos, github, (done, total, name) => {
    const elapsed = Date.now() - scoreStart;
    const avgTime = elapsed / done;
    const remaining = Math.round((total - done) * avgTime / 1000);
    logProgress(`Scoring: ${done}/${total} - ${name} (~${remaining}s remaining)`);
    
    // Also log every 10 repos or every 30 seconds
    if (done % 10 === 0 || Date.now() - lastLogTime > 30000) {
      console.log(); // newline
      log(`   Progress: ${done}/${total} repos scored (${formatDuration(elapsed)})`);
      lastLogTime = Date.now();
    }
  });
  console.log(); // newline after progress
  log(`✅ Scoring complete (${formatDuration(Date.now() - scoreStart)})`);

  // Separate promising from skipped
  const promising = scores.filter(s => !s.skipReason);
  const skipped = scores.filter(s => s.skipReason);

  log(`\n${'═'.repeat(60)}`);
  log(`PROMISE SCORES (sorted highest first)`);
  log(`${'═'.repeat(60)}`);
  
  for (const score of scores.slice(0, 20)) {
    const status = score.skipReason ? `⏭️  SKIP: ${score.skipReason}` : '✅ PROCESS';
    console.log(`  ${score.repo.name.padEnd(30)} ${formatScore(score).padEnd(50)} ${status}`);
  }
  if (scores.length > 20) {
    console.log(`  ... and ${scores.length - 20} more`);
  }

  log(`\nSummary: ${promising.length} to process, ${skipped.length} skipped`);

  // Save skipped repos
  const skippedPath = join(process.cwd(), 'output', 'skipped.json');
  writeFileSync(skippedPath, JSON.stringify(
    skipped.map(s => ({ name: s.repo.name, score: s.score, reason: s.skipReason })),
    null, 2
  ));
  log(`Saved skipped repos to ${skippedPath}`);

  if (promising.length === 0) {
    log('No promising repos to process. Done.');
    return;
  }

  // Step 3: Process promising repos
  log(`\n${'═'.repeat(60)}`);
  log(`PROCESSING ${promising.length} PROMISING REPOS`);
  log(`${'═'.repeat(60)}\n`);

  const results: Array<{
    name: string;
    score: number;
    analysis: CoreAnalysis | null;
    readmePath: string | null;
    imagePath: string | null;
    error: string | null;
  }> = [];

  const processStart = Date.now();
  
  for (let i = 0; i < promising.length; i++) {
    const { repo, score } = promising[i];
    const [owner, name] = repo.full_name.split('/');
    const repoStart = Date.now();
    
    console.log(`\n┌─ [${i + 1}/${promising.length}] ${name} (score: ${score})`);
    console.log(`│`);

    try {
      // Analyze the repo
      console.log(`│  🔬 Analyzing with Claude... (this takes 5-15s)`);
      const analyzeStart = Date.now();
      const analysis = await analyzer.analyzeRepo(owner, name);
      console.log(`│     Done in ${formatDuration(Date.now() - analyzeStart)}`);
      
      console.log(`│  📌 Core: ${(analysis.core_value || analysis.one_liner).substring(0, 60)}...`);
      console.log(`│  📊 Verdict: ${analysis.verdict}`);

      // Skip if no core value found
      if (!analysis.has_core || analysis.verdict === 'dead' || analysis.verdict === 'no_core') {
        console.log(`│`);
        console.log(`└─ ⏭️  Skipping - no clear core value`);
        results.push({ name, score, analysis, readmePath: null, imagePath: null, error: 'No core value' });
        continue;
      }

      // Fetch additional context for README generation
      console.log(`│  📥 Fetching repo context...`);
      const contextStart = Date.now();
      const [existingReadme, packageJson, fileTree] = await Promise.all([
        github.getFileContent(owner, name, 'README.md'),
        github.getFileContent(owner, name, 'package.json'),
        github.getRepoTree(owner, name, 100),
      ]);
      console.log(`│     Done in ${formatDuration(Date.now() - contextStart)}`);

      // Generate optimized README
      console.log(`│  ✍️  Generating README with Claude... (this takes 10-20s)`);
      const genStart = Date.now();
      const ctx: ReadmeContext = {
        repo,
        analysis,
        existingReadme,
        packageJson,
        fileTree,
      };
      const readme = await readmeGen.generateReadme(ctx);
      console.log(`│     Done in ${formatDuration(Date.now() - genStart)}`);

      // Save README to output
      const filename = formatReadmeFilename(repo);
      const readmePath = join(OUTPUT_DIR, filename);
      writeFileSync(readmePath, readme);
      console.log(`│  💾 Saved: ${filename}`);

      // Generate cover image
      let imagePath: string | null = null;
      if (process.env.GEMINI_API_KEY) {
        console.log(`│  🎨 Generating cover image... (this takes 5-15s)`);
        const imageStart = Date.now();
        try {
          // Create a minimal TrackedRepo for the image generator
          const trackedRepo: TrackedRepo = {
            id: `${owner}/${name}`,
            name,
            owner,
            state: 'ready',
            analysis,
            analyzed_at: new Date().toISOString(),
            pending_action: null,
            pending_since: null,
            last_message_id: null,
            last_push_at: repo.pushed_at,
            killed_at: null,
            shipped_at: null,
            cover_image_url: null,
          };
          // Import aspect ratio from prompt builder
          const { buildCoverPrompt } = await import('../lib/prompts.js');
          const { aspectRatio } = buildCoverPrompt(trackedRepo);
          const imageBuffer = await generateRepoCover(trackedRepo, aspectRatio);
          imagePath = join(IMAGES_DIR, `${name}-cover.png`);
          writeFileSync(imagePath, imageBuffer);
          console.log(`│     Done in ${formatDuration(Date.now() - imageStart)}`);
          console.log(`│  🖼️  Saved: ${name}-cover.png`);
        } catch (imgError) {
          console.log(`│     ⚠️  Image failed: ${imgError instanceof Error ? imgError.message : 'Unknown'}`);
        }
      } else {
        console.log(`│  ⚠️  Skipping image (no GEMINI_API_KEY)`);
      }
      
      console.log(`│`);
      console.log(`│  🐦 Tweet: "${(analysis.tweet_draft || '(none)').substring(0, 50)}..."`);
      console.log(`└─ ✅ Complete (${formatDuration(Date.now() - repoStart)})`);
      
      results.push({ name, score, analysis, readmePath, imagePath, error: null });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.log(`│`);
      console.log(`└─ ❌ Error: ${errorMsg}`);
      results.push({ name, score, analysis: null, readmePath: null, imagePath: null, error: errorMsg });
    }
  }
  
  log(`\n✅ Processing complete (${formatDuration(Date.now() - processStart)})`);

  // Step 4: Save summary
  const summaryPath = join(process.cwd(), 'output', 'summary.json');
  writeFileSync(summaryPath, JSON.stringify({
    processed_at: new Date().toISOString(),
    days_back: DAYS_BACK,
    include_private: INCLUDE_PRIVATE,
    total_repos: repos.length,
    promising: promising.length,
    skipped: skipped.length,
    results: results.map(r => ({
      name: r.name,
      score: r.score,
      // Full analysis fields for image regeneration
      one_liner: r.analysis?.one_liner || null,
      what_it_does: r.analysis?.what_it_does || null,
      core_value: r.analysis?.core_value || null,
      why_core: r.analysis?.why_core || null,
      verdict: r.analysis?.verdict || null,
      verdict_reason: r.analysis?.verdict_reason || null,
      tweet_draft: r.analysis?.tweet_draft || null,
      readme_path: r.readmePath,
      image_path: r.imagePath,
      error: r.error,
    })),
  }, null, 2));

  // Final summary
  const totalTime = Date.now() - scriptStart;
  
  const successful = results.filter(r => r.readmePath);
  const withImages = results.filter(r => r.imagePath);
  const failed = results.filter(r => r.error && r.error !== 'No core value');
  const noCore = results.filter(r => r.error === 'No core value');

  console.log(`
╔════════════════════════════════════════════════════════════╗
║  COMPLETE - ${formatDuration(totalTime)} total                              
╚════════════════════════════════════════════════════════════╝

  📊 Results:
     ✅ READMEs generated: ${successful.length}
     🎨 Cover images:      ${withImages.length}
     ⏭️  No core value:     ${noCore.length}
     ❌ Errors:            ${failed.length}
     📁 READMEs:           ${OUTPUT_DIR}
     🖼️  Images:            ${IMAGES_DIR}
     📋 Summary:           ${summaryPath}

  🚀 Next steps:
  1. Review generated READMEs in output/readmes/
  2. Review cover images in output/images/
  3. Copy the ones you like to your repos
  4. Use the tweet drafts for launch announcements
  `);

  // List successful repos
  if (successful.length > 0) {
    console.log('  Generated assets:');
    for (const r of successful) {
      const hasImage = r.imagePath ? '🖼️' : '  ';
      console.log(`     ${hasImage} ${r.name}`);
    }
    console.log();
  }
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
