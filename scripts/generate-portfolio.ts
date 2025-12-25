#!/usr/bin/env npx tsx
/**
 * Portfolio Generator
 *
 * Generates portfolio.json from readmes-compiled.md
 * Scoring = Priority (70%) + Validation (30%)
 *
 * Tiers:
 * - CORE: The hub (github-tndr)
 * - INTEGRATED: Tools that feed into the hub
 * - STANDALONE: Shipped products that live independently
 * - INCUBATING: High potential, needs validation
 * - ARCHIVED: Paused, might revisit
 * - KILLED: Delete or merge
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// User's explicit priorities from conversation
const USER_PRIORITIES: Record<string, {
  tier: 'CORE' | 'INTEGRATED' | 'STANDALONE' | 'INCUBATING' | 'ARCHIVED' | 'KILLED';
  notes: string;
  suggestedTitle: string;
}> = {
  'github-tndr': { tier: 'CORE', notes: 'hub for all my life automations & personal OS', suggestedTitle: 'Ship or Kill Bot' },
  'prmpt-hstry': { tier: 'INTEGRATED', notes: 'cursor optimizations, merge cursor-habits here', suggestedTitle: 'Cursor Maxxing' },
  'bel-rtr': { tier: 'INTEGRATED', notes: 'migrated as tool for github-bot', suggestedTitle: 'Chart AI' },
  'tg-ingest': { tier: 'INTEGRATED', notes: 'very high potential, private repo', suggestedTitle: 'TG Ingest' },
  'arena-lib': { tier: 'INTEGRATED', notes: 'my taste is edge, disorganized but interesting', suggestedTitle: 'Taste Library' },
  'rev-agg': { tier: 'STANDALONE', notes: 'already posted, Frank DeGods shared', suggestedTitle: 'Buyback Tracker' },
  'tweet-price': { tier: 'STANDALONE', notes: 'need story to tweet, might be data query not big site', suggestedTitle: 'Tweet Price Charts' },
  'kab-query': { tier: 'STANDALONE', notes: 'already shipped, one time query', suggestedTitle: 'Kabuto Cards' },
  'unfllw': { tier: 'INCUBATING', notes: 'could get very popular, needs resurrection, private', suggestedTitle: 'Unfollow Bot' },
  'habit-snapper': { tier: 'ARCHIVED', notes: 'archived, concepts could apply to autobot', suggestedTitle: 'Habit Snapper' },
  'whp-app': { tier: 'ARCHIVED', notes: 'random if i ever have free time idea', suggestedTitle: 'Whop Certificates' },
  'spaces-chat': { tier: 'ARCHIVED', notes: '', suggestedTitle: 'Spaces Chat' },
  'cursortimer': { tier: 'ARCHIVED', notes: '', suggestedTitle: 'Cursor Timer' },
  'coursebuilder': { tier: 'ARCHIVED', notes: '', suggestedTitle: 'Course AI' },
  'chart-predictoor': { tier: 'ARCHIVED', notes: '', suggestedTitle: 'Chart Predictoor' },
  'catalysts': { tier: 'ARCHIVED', notes: '', suggestedTitle: 'Why Pump' },
  'anti-slop-lib': { tier: 'ARCHIVED', notes: '', suggestedTitle: 'Anti-Slop' },
  'ai-changelog': { tier: 'ARCHIVED', notes: '', suggestedTitle: 'AI Arbitrage' },
  'ai-assistant-grows': { tier: 'ARCHIVED', notes: '', suggestedTitle: 'Agent Course' },
  'cursor-habits': { tier: 'KILLED', notes: 'merge with prmpt-hstry', suggestedTitle: '(merge)' },
  'physics-vid': { tier: 'KILLED', notes: 'random one-shot', suggestedTitle: '(stub)' },
  'rohunvora': { tier: 'KILLED', notes: 'profile README', suggestedTitle: '(profile)' },
  'llm-arb': { tier: 'KILLED', notes: 'empty', suggestedTitle: '(empty)' },
  'gt-test': { tier: 'KILLED', notes: 'test repo', suggestedTitle: '(test)' },
  'hl-analyzer': { tier: 'KILLED', notes: 'empty', suggestedTitle: '(empty)' },
  'rohun': { tier: 'KILLED', notes: 'old boilerplate', suggestedTitle: '(boilerplate)' },
  'rrcalc': { tier: 'KILLED', notes: 'old', suggestedTitle: '(old)' },
  'srs-test': { tier: 'KILLED', notes: 'test', suggestedTitle: '(test)' },
  'iqmode': { tier: 'KILLED', notes: 'empty', suggestedTitle: '(empty)' },
  'unfllw-old': { tier: 'KILLED', notes: 'old empty version', suggestedTitle: '(empty)' },
};

// Priority scores by tier
const TIER_SCORES: Record<string, number> = {
  'CORE': 70,
  'INTEGRATED': 55,
  'STANDALONE': 45,
  'INCUBATING': 35,
  'ARCHIVED': 15,
  'KILLED': -30,
};

interface Project {
  name: string;
  description: string;
  lastUpdated: string;
  liveUrl: string | null;
  stars: number;
  techStack: string[];
  hasReadme: boolean;
}

interface ScoredProject extends Project {
  tier: string;
  priorityScore: number;
  validationScore: number;
  totalScore: number;
  notes: string;
  suggestedTitle: string;
}

// Parse the readmes-compiled.md file
function parseReadmesCompiled(filePath: string): Project[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const projects: Project[] = [];

  const projectSections = content.split(/^### /m).slice(1);

  for (const section of projectSections) {
    const lines = section.trim().split('\n');
    const name = lines[0].trim();

    if (!name || name.includes('Quick Index') || name.includes('Full Project')) continue;

    let description = '';
    let lastUpdated = '';
    let liveUrl: string | null = null;
    let stars = 0;
    let techStack: string[] = [];
    let hasReadme = true;

    for (const line of lines) {
      if (line.startsWith('>')) {
        description = line.replace(/^>\s*\*?\*?/, '').replace(/\*?\*?$/, '').trim();
      }
      const updatedMatch = line.match(/\*\*Last updated:\*\*\s*(\d{4}-\d{2}-\d{2})/);
      if (updatedMatch) lastUpdated = updatedMatch[1];

      const liveMatch = line.match(/\*\*Live:\*\*\s*(https?:\/\/[^\s]+)/);
      if (liveMatch) liveUrl = liveMatch[1];

      const starsMatch = line.match(/\*\*Stars:\*\*\s*(\d+)/);
      if (starsMatch) stars = parseInt(starsMatch[1], 10);

      const techMatch = line.match(/\*\*Tech:\*\*\s*(.+)/);
      if (techMatch) techStack = techMatch[1].split(',').map(t => t.trim()).filter(Boolean);

      if (line.includes('*(No README)*')) hasReadme = false;
    }

    if (name && lastUpdated) {
      projects.push({ name, description, lastUpdated, liveUrl, stars, techStack, hasReadme });
    }
  }

  return projects;
}

function daysSince(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function scoreProject(project: Project): ScoredProject {
  const userPriority = USER_PRIORITIES[project.name];
  const tier = userPriority?.tier || 'ARCHIVED';
  const notes = userPriority?.notes || '';
  const suggestedTitle = userPriority?.suggestedTitle || project.name;

  // Priority Score (70% weight) - based on user's explicit tier
  const priorityScore = TIER_SCORES[tier] || 0;

  // Validation Score (30% weight) - objective metrics
  const daysSinceUpdate = daysSince(project.lastUpdated);

  // Recency (0-10)
  let recencyScore = 0;
  if (daysSinceUpdate <= 3) recencyScore = 10;
  else if (daysSinceUpdate <= 7) recencyScore = 8;
  else if (daysSinceUpdate <= 14) recencyScore = 6;
  else if (daysSinceUpdate <= 30) recencyScore = 4;
  else if (daysSinceUpdate <= 60) recencyScore = 2;

  // Live URL (0-10)
  const liveScore = project.liveUrl ? 10 : 0;

  // Stars (0-10)
  const starsScore = Math.min(10, project.stars * 2);

  const validationScore = recencyScore + liveScore + starsScore;

  // Total: Priority (70%) + Validation (30%)
  const totalScore = Math.round(priorityScore + (validationScore * 0.3));

  return {
    ...project,
    tier,
    priorityScore,
    validationScore,
    totalScore,
    notes,
    suggestedTitle,
  };
}

// Main execution
const readmesPath = path.join(__dirname, '..', 'readmes-compiled.md');
const projects = parseReadmesCompiled(readmesPath);
const scoredProjects = projects.map(scoreProject);

// Sort by total score descending
scoredProjects.sort((a, b) => b.totalScore - a.totalScore);

// Group by tier
const byTier: Record<string, ScoredProject[]> = {
  CORE: [],
  INTEGRATED: [],
  STANDALONE: [],
  INCUBATING: [],
  ARCHIVED: [],
  KILLED: [],
};

scoredProjects.forEach(p => {
  if (byTier[p.tier]) byTier[p.tier].push(p);
});

// Output
console.log('\n' + '='.repeat(100));
console.log('PORTFOLIO GENERATOR - Hub-Centric Model');
console.log('='.repeat(100));
console.log(`\nScored ${scoredProjects.length} projects on ${new Date().toISOString().split('T')[0]}\n`);

console.log('SUMMARY BY TIER:');
Object.entries(byTier).forEach(([tier, projects]) => {
  const emoji = tier === 'CORE' ? '🧠' : tier === 'INTEGRATED' ? '🔌' : tier === 'STANDALONE' ? '🚀' :
                tier === 'INCUBATING' ? '🧪' : tier === 'ARCHIVED' ? '📦' : '☠️';
  console.log(`  ${emoji} ${tier}: ${projects.length} projects`);
});

console.log('\n' + '-'.repeat(100));
console.log(
  'SCORE'.padEnd(7) +
  'TIER'.padEnd(12) +
  'PROJECT'.padEnd(18) +
  'TITLE'.padEnd(22) +
  'LIVE'.padEnd(6) +
  'NOTES'
);
console.log('-'.repeat(100));

scoredProjects.forEach(p => {
  const row =
    String(p.totalScore).padEnd(7) +
    p.tier.padEnd(12) +
    p.name.substring(0, 16).padEnd(18) +
    p.suggestedTitle.substring(0, 20).padEnd(22) +
    (p.liveUrl ? 'YES' : 'NO').padEnd(6) +
    (p.notes || '-').substring(0, 40);
  console.log(row);
});

console.log('-'.repeat(100));

// Detailed tier breakdown
console.log('\n' + '='.repeat(100));
console.log('TIER DETAILS');
console.log('='.repeat(100));

const tierEmojis: Record<string, string> = {
  CORE: '🧠',
  INTEGRATED: '🔌',
  STANDALONE: '🚀',
  INCUBATING: '🧪',
  ARCHIVED: '📦',
  KILLED: '☠️',
};

const tierDescriptions: Record<string, string> = {
  CORE: 'The brain - your personal OS hub',
  INTEGRATED: 'Tools that feed into the hub',
  STANDALONE: 'Shipped products, live independently',
  INCUBATING: 'High potential, needs validation',
  ARCHIVED: 'Paused, might revisit',
  KILLED: 'Delete or merge',
};

Object.entries(byTier).forEach(([tier, projects]) => {
  if (projects.length === 0) return;

  console.log(`\n${tierEmojis[tier]} ${tier} - ${tierDescriptions[tier]} (${projects.length})`);
  console.log('-'.repeat(60));

  projects.forEach(p => {
    const urlIndicator = p.liveUrl ? '🌐' : '  ';
    const starsIndicator = p.stars > 0 ? `⭐${p.stars}` : '';
    console.log(`  ${String(p.totalScore).padStart(3)} | ${p.suggestedTitle.padEnd(20)} ${urlIndicator} ${starsIndicator}`);
    if (p.notes) {
      console.log(`       └─ ${p.notes}`);
    }
  });
});

// Output JSON
const outputPath = path.join(__dirname, '..', 'portfolio.json');
fs.writeFileSync(outputPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  summary: {
    total: scoredProjects.length,
    byTier: Object.fromEntries(Object.entries(byTier).map(([k, v]) => [k, v.length])),
  },
  projects: scoredProjects,
}, null, 2));

console.log(`\n\nJSON output saved to: ${outputPath}`);
