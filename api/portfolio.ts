export const config = { runtime: 'edge' };

import { kv } from '@vercel/kv';

// Cache key and TTL (4 hours)
const CACHE_KEY = 'portfolio:data';
const CACHE_TTL = 60 * 60 * 4;

// User's explicit priorities - maps repo name to tier and metadata
const USER_PRIORITIES: Record<string, {
  tier: 'CORE' | 'INTEGRATED' | 'STANDALONE' | 'INCUBATING' | 'ARCHIVED' | 'KILLED';
  notes: string;
  displayName: string;
}> = {
  'github-tndr': { tier: 'CORE', notes: 'Hub for all my life automations & personal OS', displayName: 'Ship or Kill Bot' },
  'prmpt-hstry': { tier: 'INTEGRATED', notes: 'Cursor optimizations', displayName: 'Cursor Maxxing' },
  'bel-rtr': { tier: 'INTEGRATED', notes: 'Migrated as tool for github-bot', displayName: 'Chart AI' },
  'arena-lib': { tier: 'INTEGRATED', notes: 'My taste is edge', displayName: 'Taste Library' },
  'rev-agg': { tier: 'STANDALONE', notes: 'Frank DeGods shared it', displayName: 'Buyback Tracker' },
  'tweet-price': { tier: 'STANDALONE', notes: 'Need story to tweet', displayName: 'Tweet Price Charts' },
  'kab-query': { tier: 'STANDALONE', notes: 'Already shipped, one time query', displayName: 'Kabuto Cards' },
  'unfllw': { tier: 'INCUBATING', notes: 'Could get very popular, needs resurrection', displayName: 'Unfollow Bot' },
  'habit-snapper': { tier: 'ARCHIVED', notes: 'Concepts could apply to hub', displayName: 'Habit Snapper' },
  'whp-app': { tier: 'ARCHIVED', notes: 'Random free time idea', displayName: 'Whop Certificates' },
  'spaces-chat': { tier: 'ARCHIVED', notes: 'Niche but useful', displayName: 'Spaces Chat' },
  'cursortimer': { tier: 'ARCHIVED', notes: 'Needs polish', displayName: 'Cursor Timer' },
  'coursebuilder': { tier: 'ARCHIVED', notes: 'Over-engineered', displayName: 'Course AI' },
  'chart-predictoor': { tier: 'ARCHIVED', notes: 'Fun, could go viral', displayName: 'Chart Predictoor' },
  'catalysts': { tier: 'ARCHIVED', notes: 'Archived', displayName: 'Why Pump' },
  'anti-slop-lib': { tier: 'ARCHIVED', notes: 'Novelty project', displayName: 'Anti-Slop' },
  'ai-changelog': { tier: 'ARCHIVED', notes: 'Needs fresh data', displayName: 'AI Arbitrage' },
  'ai-assistant-grows': { tier: 'ARCHIVED', notes: 'Finish lessons someday', displayName: 'Agent Course' },
  // KILLED tier - hidden from portfolio
  'cursor-habits': { tier: 'KILLED', notes: 'merge', displayName: '' },
  'physics-vid': { tier: 'KILLED', notes: 'stub', displayName: '' },
  'rohunvora': { tier: 'KILLED', notes: 'profile', displayName: '' },
  'llm-arb': { tier: 'KILLED', notes: 'empty', displayName: '' },
  'gt-test': { tier: 'KILLED', notes: 'test', displayName: '' },
  'hl-analyzer': { tier: 'KILLED', notes: 'empty', displayName: '' },
  'rohun': { tier: 'KILLED', notes: 'boilerplate', displayName: '' },
  'rrcalc': { tier: 'KILLED', notes: 'old', displayName: '' },
  'srs-test': { tier: 'KILLED', notes: 'test', displayName: '' },
  'iqmode': { tier: 'KILLED', notes: 'empty', displayName: '' },
};

// Map tiers to frontend categories
const TIER_TO_CATEGORY: Record<string, 'active' | 'done' | 'paused'> = {
  'CORE': 'active',
  'INTEGRATED': 'active',
  'INCUBATING': 'active',
  'STANDALONE': 'done',
  'ARCHIVED': 'paused',
  'KILLED': 'paused', // Hidden anyway
};

interface GitHubRepo {
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  pushed_at: string;
  private: boolean;
}

interface PortfolioProject {
  name: string;
  displayName: string;
  description: string;
  repoUrl: string;
  liveUrl: string | null;
  stars: number;
  pushed_at: number | null; // timestamp in ms for frontend sorting
  category: 'active' | 'done' | 'paused';
  notes: string;
}

interface PortfolioData {
  generatedAt: string;
  projects: PortfolioProject[];
  summary: {
    active: number;
    done: number;
    paused: number;
  };
}

async function fetchGitHubRepos(): Promise<GitHubRepo[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');

  const repos: GitHubRepo[] = [];
  let page = 1;

  while (page <= 3) { // Max 3 pages (300 repos)
    const response = await fetch(
      `https://api.github.com/user/repos?sort=pushed&per_page=100&page=${page}&affiliation=owner`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'github-tndr-portfolio',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json() as GitHubRepo[];
    repos.push(...data);

    if (data.length < 100) break;
    page++;
  }

  return repos;
}

function buildPortfolio(repos: GitHubRepo[]): PortfolioData {
  const projects: PortfolioProject[] = [];

  for (const repo of repos) {
    // Skip private repos
    if (repo.private) continue;

    const priority = USER_PRIORITIES[repo.name];

    // Skip KILLED tier
    if (priority?.tier === 'KILLED') continue;

    // Skip repos not in our priority list (unknown repos)
    if (!priority) continue;

    const category = TIER_TO_CATEGORY[priority.tier] || 'paused';

    projects.push({
      name: repo.name,
      displayName: priority.displayName || repo.name,
      description: repo.description || '',
      repoUrl: repo.html_url,
      liveUrl: repo.homepage || null,
      stars: repo.stargazers_count,
      pushed_at: repo.pushed_at ? new Date(repo.pushed_at).getTime() : null,
      category,
      notes: priority.notes,
    });
  }

  // Sort: active first, then done, then paused
  // Within each category, sort by stars descending
  const categoryOrder = { active: 0, done: 1, paused: 2 };
  projects.sort((a, b) => {
    const catDiff = categoryOrder[a.category] - categoryOrder[b.category];
    if (catDiff !== 0) return catDiff;
    return b.stars - a.stars;
  });

  return {
    generatedAt: new Date().toISOString(),
    projects,
    summary: {
      active: projects.filter(p => p.category === 'active').length,
      done: projects.filter(p => p.category === 'done').length,
      paused: projects.filter(p => p.category === 'paused').length,
    },
  };
}

export default async function handler(req: Request): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
  };

  try {
    // Check cache first
    const cached = await kv.get<PortfolioData>(CACHE_KEY);
    if (cached) {
      return new Response(JSON.stringify(cached), { headers });
    }

    // Fetch fresh data
    const repos = await fetchGitHubRepos();
    const portfolio = buildPortfolio(repos);

    // Cache it
    await kv.set(CACHE_KEY, portfolio, { ex: CACHE_TTL });

    return new Response(JSON.stringify(portfolio), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers }
    );
  }
}
