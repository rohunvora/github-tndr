#!/usr/bin/env npx tsx

/**
 * Regenerate Images Script
 * 
 * Fast-pass script to regenerate all cover images using the new Visual Constitution
 * prompt system without re-analyzing the codebases.
 * 
 * - Reads analysis data from output/summary.json
 * - Backs up existing images to output/images_backup/
 * - Regenerates images with Gemini 3 Pro Image (Nano Banana Pro)
 */

import 'dotenv/config';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { generateRepoCover } from '../lib/nano-banana.js';
import { TrackedRepo } from '../lib/core-types.js';

const IMAGES_DIR = join(process.cwd(), 'output', 'images');
const BACKUP_DIR = join(process.cwd(), 'output', 'images_backup');
const SUMMARY_PATH = join(process.cwd(), 'output', 'summary.json');

interface SummaryResult {
  name: string;
  score: number;
  one_liner: string | null;
  what_it_does: string | null;
  core_value: string | null;
  why_core: string | null;
  verdict: string | null;
  verdict_reason: string | null;
  tweet_draft: string | null;
  readme_path: string | null;
  image_path: string | null;
  error: string | null;
}

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  Image Regeneration - Nano Banana Pro Visual Constitution  ║
╚════════════════════════════════════════════════════════════╝
`);

  // Validate env
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ Missing GEMINI_API_KEY');
    process.exit(1);
  }

  // Check summary exists
  if (!existsSync(SUMMARY_PATH)) {
    console.error('❌ No summary.json found. Run optimize-readmes first.');
    process.exit(1);
  }

  // Ensure backup directory exists
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
    log(`📁 Created backup directory: ${BACKUP_DIR}`);
  }

  // Load summary
  const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf-8'));
  const results: SummaryResult[] = summary.results;

  // Filter to repos with core analysis data (for image generation)
  // Note: what_it_does and one_liner may be missing from older summaries, use core_value as fallback
  const eligible = results.filter((r: SummaryResult) => 
    r.core_value && 
    r.verdict && 
    r.verdict !== 'dead' && 
    r.verdict !== 'no_core'
  );

  log(`Found ${eligible.length} repos eligible for image regeneration\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < eligible.length; i++) {
    const result = eligible[i];
    console.log(`┌─ [${i + 1}/${eligible.length}] ${result.name}`);

    // Reconstruct TrackedRepo for the prompt builder
    // Use core_value as fallback for missing fields from older summaries
    const repo: TrackedRepo = {
      id: `owner/${result.name}`,
      name: result.name,
      owner: 'owner',
      state: 'ready',
      analysis: {
        one_liner: result.one_liner || result.core_value!,
        code_one_liner: result.core_value!, // Code-derived
        what_it_does: result.what_it_does || result.core_value!,
        core_value: result.core_value!,
        why_core: result.why_core || '',
        verdict: result.verdict as 'ship' | 'cut_to_core' | 'no_core' | 'dead',
        verdict_reason: result.verdict_reason || '',
        tweet_draft: result.tweet_draft,
        has_core: true,
        keep: [],
        cut: [],
        core_evidence: [],
        readme_claims: [],
        mismatch_evidence: [],
        demo_command: null,
        demo_artifact: null,
        shareable_angle: null,
        pride_level: 'comfortable',
        pride_blockers: [],
      },
      analyzed_at: new Date().toISOString(),
      pending_action: null,
      pending_since: null,
      last_message_id: null,
      last_push_at: new Date().toISOString(),
      killed_at: null,
      shipped_at: null,
      cover_image_url: null,
    };

    try {
      // Backup existing image if present
      const imagePath = join(IMAGES_DIR, `${result.name}-cover.png`);
      if (existsSync(imagePath)) {
        const backupPath = join(BACKUP_DIR, `${result.name}-cover-${Date.now()}.png`);
        copyFileSync(imagePath, backupPath);
        console.log(`│  📦 Backed up existing image`);
      }

      // Generate new image (always 16:9 landscape)
      console.log(`│  🎨 Generating with Gemini 3 Pro Image (16:9)...`);
      const start = Date.now();
      
      const imageBuffer = await generateRepoCover(repo);
      writeFileSync(imagePath, imageBuffer);
      
      const duration = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`│  ✅ Saved in ${duration}s`);
      console.log(`└─────────────────────────────────────\n`);
      success++;
    } catch (e: any) {
      console.log(`│  ❌ Failed: ${e.message}`);
      console.log(`└─────────────────────────────────────\n`);
      failed++;
    }
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║  COMPLETE                                                  ║
╚════════════════════════════════════════════════════════════╝

  ✅ Success: ${success}
  ❌ Failed:  ${failed}
  📁 Images:  ${IMAGES_DIR}
  📦 Backups: ${BACKUP_DIR}
`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
