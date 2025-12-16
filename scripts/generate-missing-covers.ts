#!/usr/bin/env npx tsx

/**
 * Generate Missing Covers
 * 
 * Generates AI cover images for specific repos that are missing them.
 * - Analyzes repo to get core value
 * - Generates cover image with Gemini
 * - Uploads to GitHub .github/social-preview.png
 */

import 'dotenv/config';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { GitHubClient } from '../lib/github.js';
import { RepoAnalyzer } from '../lib/analyzer.js';
import { generateRepoCover } from '../lib/nano-banana.js';
import { TrackedRepo } from '../lib/core-types.js';

// Repos to generate covers for (user-owned repos missing .github/social-preview.png)
const TARGET_REPOS = ['bel-rtr', 'hl-analyzer', 'cursortimer', 'iqmode'];
const OWNER = 'rohunvora';
const IMAGES_DIR = join(process.cwd(), 'output', 'images');

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function uploadToGitHub(owner: string, repo: string, imagePath: string, token: string): Promise<boolean> {
  try {
    const imageBuffer = readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // Check if file already exists
    const existingRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.github/social-preview.png`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    
    let sha: string | undefined;
    if (existingRes.ok) {
      const existing = await existingRes.json() as { sha: string };
      sha = existing.sha;
    }
    
    const uploadRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.github/social-preview.png`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: sha ? 'chore: update social preview image' : 'chore: add social preview image',
        content: base64Image,
        ...(sha ? { sha } : {}),
      }),
    });
    
    if (uploadRes.ok) {
      log(`  ✅ Uploaded to .github/social-preview.png`);
      return true;
    } else {
      const error = await uploadRes.text();
      log(`  ❌ Upload failed: ${error}`);
      return false;
    }
  } catch (e: any) {
    log(`  ❌ Upload error: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  Generate Missing Covers                                   ║
╚════════════════════════════════════════════════════════════╝
`);

  // Validate env
  if (!process.env.GITHUB_TOKEN) {
    console.error('❌ Missing GITHUB_TOKEN');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Missing ANTHROPIC_API_KEY');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ Missing GEMINI_API_KEY');
    process.exit(1);
  }

  // Ensure output directory exists
  if (!existsSync(IMAGES_DIR)) {
    mkdirSync(IMAGES_DIR, { recursive: true });
  }

  const github = new GitHubClient(process.env.GITHUB_TOKEN);
  const analyzer = new RepoAnalyzer(process.env.ANTHROPIC_API_KEY!, process.env.GITHUB_TOKEN!);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < TARGET_REPOS.length; i++) {
    const repoName = TARGET_REPOS[i];
    console.log(`\n┌─ [${i + 1}/${TARGET_REPOS.length}] ${repoName}`);
    
    try {
      // Step 1: Analyze repo
      console.log(`│  🔍 Analyzing...`);
      const analysis = await analyzer.analyzeRepo(OWNER, repoName);
      
      if (!analysis.has_core || !analysis.core_value) {
        console.log(`│  ⏭️ Skipping - no core value found`);
        continue;
      }
      
      console.log(`│  📝 "${analysis.one_liner}"`);
      
      // Step 2: Create TrackedRepo for image generation
      const repo: TrackedRepo = {
        id: `${OWNER}/${repoName}`,
        name: repoName,
        owner: OWNER,
        state: 'ready',
        analysis,
        analyzed_at: new Date().toISOString(),
        pending_action: null,
        pending_since: null,
        last_message_id: null,
        last_push_at: new Date().toISOString(),
        killed_at: null,
        shipped_at: null,
        cover_image_url: null,
      };
      
      // Step 3: Generate cover image
      console.log(`│  🎨 Generating cover image...`);
      const imageBuffer = await generateRepoCover(repo);
      
      const imagePath = join(IMAGES_DIR, `${repoName}-cover.png`);
      writeFileSync(imagePath, imageBuffer);
      console.log(`│  💾 Saved locally: ${imagePath}`);
      
      // Step 4: Upload to GitHub
      console.log(`│  📤 Uploading to GitHub...`);
      const uploaded = await uploadToGitHub(OWNER, repoName, imagePath, process.env.GITHUB_TOKEN!);
      
      if (uploaded) {
        success++;
        console.log(`└─ ✅ Complete\n`);
      } else {
        failed++;
        console.log(`└─ ⚠️ Generated but upload failed\n`);
      }
      
    } catch (e: any) {
      console.log(`│  ❌ Error: ${e.message}`);
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
`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
