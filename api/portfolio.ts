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
  // CORE - main project
  'github-tndr': { tier: 'CORE', notes: 'Hub for all my life automations & personal OS', displayName: 'Ship or Kill Bot' },

  // INTEGRATED - tools that feed into core
  'cursor-maxxing': { tier: 'INTEGRATED', notes: 'Cursor optimizations', displayName: 'Cursor Maxxing' },
  'chart-ai': { tier: 'INTEGRATED', notes: 'Migrated as tool for github-bot', displayName: 'Chart AI' },
  'taste-library': { tier: 'INTEGRATED', notes: 'My taste is edge', displayName: 'Taste Library' },

  // STANDALONE - shipped and complete
  'my-cmc': { tier: 'STANDALONE', notes: 'Frank DeGods shared it', displayName: 'Buyback Tracker' },
  'tweet-price-charts': { tier: 'STANDALONE', notes: 'Need story to tweet', displayName: 'Tweet Price Charts' },
  'kabuto-cards-dashboard': { tier: 'STANDALONE', notes: 'Already shipped, one time query', displayName: 'Kabuto Cards' },

  // INCUBATING - high potential, needs work
  'unfollow-bot': { tier: 'INCUBATING', notes: 'Could get very popular, needs resurrection', displayName: 'Unfollow Bot' },

  // ARCHIVED - on hold
  'habit-snapper': { tier: 'ARCHIVED', notes: 'Concepts could apply to hub', displayName: 'Habit Snapper' },
  'whop-app-ideas': { tier: 'ARCHIVED', notes: 'Random free time idea', displayName: 'Whop Certificates' },
  'spaces-chat': { tier: 'ARCHIVED', notes: 'Niche but useful', displayName: 'Spaces Chat' },
  'cursortimer': { tier: 'ARCHIVED', notes: 'Needs polish', displayName: 'Cursor Timer' },
  'course-ai': { tier: 'ARCHIVED', notes: 'Over-engineered', displayName: 'Course AI' },
  'chart-predictoor': { tier: 'ARCHIVED', notes: 'Fun, could go viral', displayName: 'Chart Predictoor' },
  'why-pump': { tier: 'ARCHIVED', notes: 'Archived', displayName: 'Why Pump' },
  'anti-slop-library': { tier: 'ARCHIVED', notes: 'Novelty project', displayName: 'Anti-Slop' },
  'ai-arbitrage': { tier: 'ARCHIVED', notes: 'Needs fresh data', displayName: 'AI Arbitrage' },
  'agent-course': { tier: 'ARCHIVED', notes: 'Finish lessons someday', displayName: 'Agent Course' },

  // KILLED tier - hidden from portfolio
  'cursor-habits': { tier: 'KILLED', notes: 'merge', displayName: '' },
  'physics-vid': { tier: 'KILLED', notes: 'stub', displayName: '' },
  'rohunvora': { tier: 'KILLED', notes: 'profile', displayName: '' },
  'rohun': { tier: 'KILLED', notes: 'boilerplate', displayName: '' },
  'rrcalc': { tier: 'KILLED', notes: 'old', displayName: '' },
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
  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get('refresh') === 'true';

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
  };

  try {
    // Check cache first (unless refresh requested)
    if (!forceRefresh) {
      const cached = await kv.get<PortfolioData>(CACHE_KEY);
      if (cached) {
        return new Response(JSON.stringify(cached), { headers });
      }
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
