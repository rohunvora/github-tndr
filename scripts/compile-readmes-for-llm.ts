#!/usr/bin/env npx tsx
/**
 * Compile READMEs for LLM Ingestion
 * 
 * Fetches all your recent GitHub repos, extracts READMEs,
 * and compresses them into an LLM-friendly format.
 * 
 * Usage:
 *   npx tsx scripts/compile-readmes-for-llm.ts
 *   npx tsx scripts/compile-readmes-for-llm.ts --days 90  # last 90 days
 *   npx tsx scripts/compile-readmes-for-llm.ts --public   # public repos only
 *   npx tsx scripts/compile-readmes-for-llm.ts --output portfolio.md
 */

import { GitHubClient, GitHubRepo } from '../lib/core/github.js';
import * as fs from 'fs';

// ============ CONFIG ============

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DEFAULT_DAYS = 150;
const DEFAULT_OUTPUT = 'readmes-compiled.md';

// Sections to strip for compression (keep essence, remove setup noise)
const SECTIONS_TO_STRIP = [
  /^#+\s*(installation|setup|getting started|prerequisites|requirements|building|contributing|license|acknowledgments?|credits|authors?|faq|troubleshooting|contact|support|changelog|roadmap|versioning)\s*$/im,
];

// Lines to strip (badges, repetitive links)
const LINES_TO_STRIP = [
  /^\s*\[!\[.*?\]\(.*?\)\]\(.*?\)\s*$/,  // Badge images with links
  /^\s*!\[.*?\]\(https:\/\/img\.shields\.io.*?\)\s*$/,  // Shield badges
  /^\s*<a href.*?<\/a>\s*$/,  // HTML links
  /^\s*<img src.*?\/>\s*$/,  // Self-closing img tags
  /^\s*<br\s*\/?>\s*$/,  // Line breaks
  /^\s*<hr\s*\/?>\s*$/,  // Horizontal rules
  /^\s*<div align.*?>\s*$/,  // Alignment divs
  /^\s*<\/div>\s*$/,  // Closing divs
  /^\s*---\s*$/,  // Horizontal rules
];

// ============ HELPERS ============

function log(msg: string) {
  console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${msg}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    days: DEFAULT_DAYS,
    publicOnly: false,
    output: DEFAULT_OUTPUT,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) {
      config.days = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--public') {
      config.publicOnly = true;
    } else if (args[i] === '--output' && args[i + 1]) {
      config.output = args[i + 1];
      i++;
    }
  }

  return config;
}

/**
 * Compress a README by:
 * 1. Stripping installation/setup/contributing sections
 * 2. Removing badges and redundant HTML
 * 3. Keeping the core "what it does" content
 */
function compressReadme(readme: string): string {
  let lines = readme.split('\n');
  
  // Remove badge lines and empty HTML
  lines = lines.filter(line => {
    for (const pattern of LINES_TO_STRIP) {
      if (pattern.test(line)) return false;
    }
    return true;
  });

  // Remove unwanted sections
  const output: string[] = [];
  let skipUntilNextHeader = false;
  let skipHeaderLevel = 0;

  for (const line of lines) {
    // Check if this is a header
    const headerMatch = line.match(/^(#+)\s+(.+)$/);
    
    if (headerMatch) {
      const level = headerMatch[1].length;
      const title = headerMatch[2];

      // Check if this section should be stripped
      let shouldStrip = false;
      for (const pattern of SECTIONS_TO_STRIP) {
        if (pattern.test(line)) {
          shouldStrip = true;
          break;
        }
      }

      if (shouldStrip) {
        skipUntilNextHeader = true;
        skipHeaderLevel = level;
        continue;
      }

      // If we hit a same-level or higher header, stop skipping
      if (skipUntilNextHeader && level <= skipHeaderLevel) {
        skipUntilNextHeader = false;
      }
    }

    if (!skipUntilNextHeader) {
      output.push(line);
    }
  }

  // Clean up multiple blank lines
  let result = output.join('\n');
  result = result.replace(/\n{3,}/g, '\n\n');
  result = result.trim();

  return result;
}

/**
 * Extract the first paragraph/one-liner from README
 */
function extractOneLiner(readme: string): string {
  // Skip the title and look for first substantial paragraph
  const lines = readme.split('\n');
  let foundTitle = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and headers
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      foundTitle = true;
      continue;
    }
    // Skip HTML, badges, images
    if (trimmed.startsWith('<') || trimmed.startsWith('!') || trimmed.startsWith('[!')) continue;
    
    // Skip very short lines (likely formatting)
    if (trimmed.length < 20) continue;
    
    // Found a real paragraph
    if (foundTitle && trimmed.length > 20) {
      // Take first sentence or up to 200 chars
      const firstSentence = trimmed.match(/^[^.!?]+[.!?]/);
      if (firstSentence && firstSentence[0].length < 200) {
        return firstSentence[0];
      }
      return trimmed.substring(0, 200) + (trimmed.length > 200 ? '...' : '');
    }
  }
  
  return '(No description)';
}

/**
 * Extract tech stack hints from README
 */
function extractTechHints(readme: string): string[] {
  const techPatterns: Array<{ pattern: RegExp; tech: string }> = [
    { pattern: /\bReact\b/i, tech: 'React' },
    { pattern: /\bNext\.?js\b/i, tech: 'Next.js' },
    { pattern: /\bTypeScript\b/i, tech: 'TypeScript' },
    { pattern: /\bNode\.?js\b/i, tech: 'Node.js' },
    { pattern: /\bPython\b/i, tech: 'Python' },
    { pattern: /\bRust\b/i, tech: 'Rust' },
    { pattern: /\bGo\b(?!ogle)/i, tech: 'Go' },
    { pattern: /\bVercel\b/i, tech: 'Vercel' },
    { pattern: /\bTelegram\b/i, tech: 'Telegram' },
    { pattern: /\bClaude\b|Anthropic/i, tech: 'Claude AI' },
    { pattern: /\bGPT|OpenAI/i, tech: 'OpenAI' },
    { pattern: /\bPostgreSQL|Postgres\b/i, tech: 'PostgreSQL' },
    { pattern: /\bRedis\b/i, tech: 'Redis' },
    { pattern: /\bMongoDB\b/i, tech: 'MongoDB' },
    { pattern: /\bDocker\b/i, tech: 'Docker' },
    { pattern: /\bKubernetes|K8s\b/i, tech: 'Kubernetes' },
    { pattern: /\bAWS\b/i, tech: 'AWS' },
    { pattern: /\bGCP\b|Google Cloud/i, tech: 'GCP' },
    { pattern: /\bSolana\b/i, tech: 'Solana' },
    { pattern: /\bEthereum\b/i, tech: 'Ethereum' },
    { pattern: /\bWeb3\b/i, tech: 'Web3' },
    { pattern: /\bGraphQL\b/i, tech: 'GraphQL' },
    { pattern: /\btRPC\b/i, tech: 'tRPC' },
    { pattern: /\bTailwind/i, tech: 'Tailwind' },
    { pattern: /\bPrisma\b/i, tech: 'Prisma' },
    { pattern: /\bSupabase\b/i, tech: 'Supabase' },
  ];

  const found = new Set<string>();
  for (const { pattern, tech } of techPatterns) {
    if (pattern.test(readme)) {
      found.add(tech);
    }
  }
  
  return Array.from(found);
}

// ============ MAIN ============

async function main() {
  if (!GITHUB_TOKEN) {
    console.error('❌ GITHUB_TOKEN environment variable required');
    console.error('   Set it: export GITHUB_TOKEN=ghp_...');
    process.exit(1);
  }

  const config = parseArgs();
  log(`🚀 Compiling READMEs (last ${config.days} days, ${config.publicOnly ? 'public only' : 'all repos'})`);

  const github = new GitHubClient(GITHUB_TOKEN);
  
  // Fetch repos
  log('📦 Fetching repos...');
  const repos = config.publicOnly 
    ? await github.getPublicRepos(config.days)
    : await github.getOwnedRepos(config.days);

  log(`   Found ${repos.length} repos`);

  // Sort by most recently pushed
  repos.sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime());

  // Compile output
  const sections: string[] = [];
  
  // Header
  sections.push(`# Project Portfolio Digest

> Auto-generated compilation of ${repos.length} projects for LLM ingestion
> Generated: ${new Date().toISOString().split('T')[0]}
> Timeframe: Last ${config.days} days

---

## Quick Index

| Project | Description | Tech Stack |
|---------|-------------|------------|`);

  // First pass: build index and collect data
  const projectData: Array<{
    repo: GitHubRepo;
    readme: string | null;
    oneLiner: string;
    techStack: string[];
  }> = [];

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    log(`📖 [${i + 1}/${repos.length}] ${repo.name}`);
    
    const [owner, name] = repo.full_name.split('/');
    const readme = await github.getFileContent(owner, name, 'README.md');
    
    const oneLiner = readme ? extractOneLiner(readme) : (repo.description || '(No description)');
    const techStack = readme ? extractTechHints(readme) : [];
    
    projectData.push({ repo, readme, oneLiner, techStack });
    
    // Add to index
    const techStackStr = techStack.slice(0, 4).join(', ') || '-';
    sections[0] += `\n| **${repo.name}** | ${oneLiner.substring(0, 60)}${oneLiner.length > 60 ? '...' : ''} | ${techStackStr} |`;
  }

  sections.push('');
  sections.push('---');
  sections.push('');
  sections.push('## Full Project Details');
  sections.push('');

  // Second pass: add compressed READMEs
  for (const { repo, readme, oneLiner, techStack } of projectData) {
    const pushedDate = new Date(repo.pushed_at).toISOString().split('T')[0];
    
    sections.push(`### ${repo.name}`);
    sections.push('');
    sections.push(`> ${oneLiner}`);
    sections.push('');
    sections.push(`- **Repo:** [${repo.full_name}](https://github.com/${repo.full_name})`);
    sections.push(`- **Last updated:** ${pushedDate}`);
    if (repo.homepage) {
      sections.push(`- **Live:** ${repo.homepage}`);
    }
    if (techStack.length > 0) {
      sections.push(`- **Tech:** ${techStack.join(', ')}`);
    }
    if (repo.stargazers_count > 0) {
      sections.push(`- **Stars:** ${repo.stargazers_count}`);
    }
    sections.push('');

    if (readme) {
      const compressed = compressReadme(readme);
      // Limit each project to ~1500 chars for efficiency
      const truncated = compressed.length > 1500 
        ? compressed.substring(0, 1500) + '\n\n...(truncated)'
        : compressed;
      
      sections.push('<details>');
      sections.push('<summary>📄 README (click to expand)</summary>');
      sections.push('');
      sections.push(truncated);
      sections.push('');
      sections.push('</details>');
    } else {
      sections.push('*(No README)*');
    }
    
    sections.push('');
    sections.push('---');
    sections.push('');
  }

  // Write output
  const output = sections.join('\n');
  fs.writeFileSync(config.output, output);

  // Stats
  const totalChars = output.length;
  const approxTokens = Math.ceil(totalChars / 4);
  
  log('');
  log('✅ Compilation complete!');
  log(`   📄 Output: ${config.output}`);
  log(`   📊 Size: ${(totalChars / 1024).toFixed(1)} KB`);
  log(`   🔢 Approx tokens: ~${approxTokens.toLocaleString()}`);
  log('');
  log('💡 Tip: Paste this file directly into ChatGPT or Claude for context about your projects');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

