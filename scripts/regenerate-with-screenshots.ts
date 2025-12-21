#!/usr/bin/env npx tsx

/**
 * Regenerate Images with Live Screenshots
 * 
 * For repos with live URLs: screenshot → polish with AI
 * For repos without: regenerate with AI from scratch (16:9)
 */

import 'dotenv/config';
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { generateRepoCover, polishScreenshot } from '../lib/nano-banana.js';
import { screenshotUrl, isUrlAccessible, closeBrowser } from '../lib/screenshot.js';
import { GitHubClient } from '../lib/core/github.js';
import { TrackedRepo } from '../lib/core/types.js';

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

async function detectLiveUrl(repoName: string, github: GitHubClient, owner: string): Promise<string | null> {
  // Check repo homepage field first
  const info = await github.getRepoInfo(owner, repoName);
  if (info?.homepage && info.homepage.startsWith('http')) {
    return info.homepage;
  }
  
  // Check for vercel.json → assume {repo}.vercel.app
  const vercelJson = await github.getFileContent(owner, repoName, 'vercel.json');
  if (vercelJson) {
    return `https://${repoName}.vercel.app`;
  }
  
  // Check for common URL patterns in README
  const readme = await github.getFileContent(owner, repoName, 'README.md');
  if (readme) {
    const vercelMatch = readme.match(/https:\/\/[a-z0-9-]+\.vercel\.app/i);
    if (vercelMatch) return vercelMatch[0];
    
    const netlifyMatch = readme.match(/https:\/\/[a-z0-9-]+\.netlify\.app/i);
    if (netlifyMatch) return netlifyMatch[0];
  }
  
  return null;
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  Regenerate Images with Live Screenshots                   ║
╚════════════════════════════════════════════════════════════╝
`);

  // Validate env
  const githubToken = process.env.GITHUB_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  
  if (!githubToken) {
    console.error('❌ Missing GITHUB_TOKEN');
    process.exit(1);
  }
  if (!geminiKey) {
    console.error('❌ Missing GEMINI_API_KEY');
    process.exit(1);
  }
  
  if (!existsSync(SUMMARY_PATH)) {
    console.error('❌ No summary.json found. Run optimize-readmes first.');
    process.exit(1);
  }

  // Initialize
  const github = new GitHubClient(githubToken);
  
  // Get GitHub username
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  const user = await userRes.json() as { login: string };
  const owner = user.login;
  
  log(`Running as ${owner}`);

  // Ensure directories exist
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Load summary
  const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf-8'));
  const results: SummaryResult[] = summary.results;

  // Filter to repos with core value
  const eligible = results.filter(r =>
    r.core_value &&
    r.verdict &&
    r.verdict !== 'dead' &&
    r.verdict !== 'no_core'
  );

  log(`Found ${eligible.length} eligible repos\n`);

  let screenshotted = 0;
  let aiGenerated = 0;
  let failed = 0;

  for (let i = 0; i < eligible.length; i++) {
    const result = eligible[i];
    console.log(`┌─ [${i + 1}/${eligible.length}] ${result.name}`);

    try {
      // Backup existing image
      const imagePath = join(IMAGES_DIR, `${result.name}-cover.png`);
      if (existsSync(imagePath)) {
        const backupPath = join(BACKUP_DIR, `${result.name}-cover-${Date.now()}.png`);
        copyFileSync(imagePath, backupPath);
        console.log(`│  📦 Backed up existing image`);
      }

      let imageBuffer: Buffer;

      // Try to detect live URL
      console.log(`│  🔍 Checking for live URL...`);
      const liveUrl = await detectLiveUrl(result.name, github, owner);

      if (liveUrl) {
        console.log(`│  🔗 Found: ${liveUrl}`);
        
        const isAccessible = await isUrlAccessible(liveUrl);
        
        if (isAccessible) {
          console.log(`│  📸 Screenshotting...`);
          const screenshotStart = Date.now();
          const rawScreenshot = await screenshotUrl(liveUrl);
          console.log(`│     Done in ${((Date.now() - screenshotStart) / 1000).toFixed(1)}s`);
          
          console.log(`│  ✨ Polishing with AI...`);
          const polishStart = Date.now();
          imageBuffer = await polishScreenshot(rawScreenshot, {
            name: result.name,
            oneLiner: result.one_liner || result.core_value!,
            coreValue: result.core_value!,
          });
          console.log(`│     Done in ${((Date.now() - polishStart) / 1000).toFixed(1)}s`);
          screenshotted++;
        } else {
          console.log(`│  ⚠️ URL not accessible, falling back to AI`);
          imageBuffer = await generateAI(result);
          aiGenerated++;
        }
      } else {
        console.log(`│  🎨 No live URL, generating with AI...`);
        imageBuffer = await generateAI(result);
        aiGenerated++;
      }

      writeFileSync(imagePath, imageBuffer);
      console.log(`│  ✅ Saved: ${result.name}-cover.png`);
      console.log(`└─────────────────────────────────────\n`);
    } catch (e: any) {
      console.log(`│  ❌ Failed: ${e.message}`);
      console.log(`└─────────────────────────────────────\n`);
      failed++;
    }
  }

  // Cleanup
  await closeBrowser();

  console.log(`
╔════════════════════════════════════════════════════════════╗
║  COMPLETE                                                  ║
╚════════════════════════════════════════════════════════════╝

  📸 Screenshots + Polish: ${screenshotted}
  🎨 AI Generated:         ${aiGenerated}
  ❌ Failed:               ${failed}
  
  Images saved to: ${IMAGES_DIR}
  Backups at: ${BACKUP_DIR}
`);
}

async function generateAI(result: SummaryResult): Promise<Buffer> {
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
    homepage: null,
  };
  
  return generateRepoCover(repo);
}

main().catch(async err => {
  console.error('Fatal error:', err);
  await closeBrowser();
  process.exit(1);
});
