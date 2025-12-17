// Portfolio - Composition layer over existing state
// Provides portfolio-level awareness without duplicating repo data

import { kv } from '@vercel/kv';
import { stateManager } from './state.js';
import { getFeedMemory } from './card-generator.js';
import { TrackedRepo } from './core-types.js';

// ============ TYPES ============

export interface ProjectSummary {
  full_name: string;
  name: string;
  status: 'active' | 'paused' | 'shipped' | 'killed';
  verdict: string | null;
  priority: number;
  last_push_days_ago: number;
  has_analysis: boolean;
}

export interface PortfolioCounts {
  active: number;
  shipped: number;
  killed: number;
  total: number;
}

export interface PortfolioPatterns {
  attention_score: number;      // 0-100: focused (high) vs scattered (low)
  active_project_count: number;
  last_shipped: string | null;
  days_since_last_ship: number | null;
}

export interface PortfolioSnapshot {
  focus: string | null;         // User's declared focus project
  projects: ProjectSummary[];   // All projects, sorted by priority
  top_projects: ProjectSummary[]; // Top 3 for LLM context (keep prompts small)
  counts: PortfolioCounts;
  patterns: PortfolioPatterns;
  generated_at: string;
}

// ============ KV KEYS ============

const PORTFOLIO_FOCUS_KEY = 'portfolio:focus';

// ============ FOCUS MANAGEMENT ============

export async function getPortfolioFocus(): Promise<string | null> {
  return kv.get<string>(PORTFOLIO_FOCUS_KEY);
}

export async function setPortfolioFocus(fullName: string | null): Promise<void> {
  if (fullName) {
    await kv.set(PORTFOLIO_FOCUS_KEY, fullName);
  } else {
    await kv.del(PORTFOLIO_FOCUS_KEY);
  }
}

// ============ HELPERS ============

function getDaysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getProjectStatus(repo: TrackedRepo): 'active' | 'paused' | 'shipped' | 'killed' {
  if (repo.state === 'shipped') return 'shipped';
  if (repo.state === 'dead') return 'killed';
  
  // Consider "paused" if no activity in 30+ days
  const daysSincePush = getDaysSince(repo.last_push_at);
  if (daysSincePush !== null && daysSincePush > 30) return 'paused';
  
  return 'active';
}

function calculateProjectPriority(repo: TrackedRepo, focus: string | null): number {
  let score = 0;
  const fullName = `${repo.owner}/${repo.name}`;
  
  // Focus bonus
  if (focus === fullName) score += 100;
  
  // Verdict-based scoring
  if (repo.analysis?.verdict === 'ship') score += 50;
  else if (repo.analysis?.verdict === 'cut_to_core') score += 30;
  
  // Recency bonus
  const daysSincePush = getDaysSince(repo.last_push_at);
  if (daysSincePush !== null) {
    if (daysSincePush < 3) score += 40;
    else if (daysSincePush < 7) score += 25;
    else if (daysSincePush < 14) score += 10;
  }
  
  // Has analysis bonus
  if (repo.analysis?.has_core) score += 15;
  
  // Penalties
  if (repo.state === 'shipped') score -= 200;
  if (repo.state === 'dead') score -= 300;
  
  return score;
}

function calculateAttentionScore(repos: TrackedRepo[]): number {
  // Attention score: how focused is the user?
  // High (80-100): Working on 1-2 active projects consistently
  // Medium (40-79): 3-4 active projects
  // Low (0-39): 5+ active projects, scattered
  
  const activeRepos = repos.filter(r => {
    const status = getProjectStatus(r);
    return status === 'active';
  });
  
  const activeCount = activeRepos.length;
  
  if (activeCount <= 1) return 95;
  if (activeCount === 2) return 80;
  if (activeCount === 3) return 60;
  if (activeCount === 4) return 45;
  if (activeCount === 5) return 30;
  return Math.max(10, 30 - (activeCount - 5) * 5);
}

// ============ MAIN FUNCTION ============

/**
 * Get a snapshot of the portfolio for AI context
 * This computes everything from existing state - no duplication
 */
export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const [repos, focus, memory] = await Promise.all([
    stateManager.getAllTrackedRepos(),
    getPortfolioFocus(),
    getFeedMemory(),
  ]);
  
  // Build project summaries with priority scores
  const projects: ProjectSummary[] = repos.map(repo => {
    const fullName = `${repo.owner}/${repo.name}`;
    const priority = calculateProjectPriority(repo, focus);
    const daysSincePush = getDaysSince(repo.last_push_at);
    
    return {
      full_name: fullName,
      name: repo.name,
      status: getProjectStatus(repo),
      verdict: repo.analysis?.verdict || null,
      priority,
      last_push_days_ago: daysSincePush ?? 999,
      has_analysis: repo.analysis !== null,
    };
  }).sort((a, b) => b.priority - a.priority);
  
  // Counts
  const counts: PortfolioCounts = {
    active: projects.filter(p => p.status === 'active').length,
    shipped: projects.filter(p => p.status === 'shipped').length,
    killed: projects.filter(p => p.status === 'killed').length,
    total: projects.length,
  };
  
  // Find last shipped date
  const shippedRepos = repos.filter(r => r.state === 'shipped' && r.shipped_at);
  const lastShipped = shippedRepos.length > 0
    ? shippedRepos.sort((a, b) => 
        new Date(b.shipped_at!).getTime() - new Date(a.shipped_at!).getTime()
      )[0].shipped_at
    : null;
  
  // Patterns
  const patterns: PortfolioPatterns = {
    attention_score: calculateAttentionScore(repos),
    active_project_count: counts.active,
    last_shipped: lastShipped,
    days_since_last_ship: getDaysSince(lastShipped),
  };
  
  return {
    focus,
    projects,
    top_projects: projects.slice(0, 3),
    counts,
    patterns,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Get a minimal portfolio summary for LLM prompts
 * Keeps token count low while providing essential context
 */
export function formatPortfolioForPrompt(snapshot: PortfolioSnapshot): string {
  const lines: string[] = [];
  
  // Focus
  if (snapshot.focus) {
    lines.push(`Current focus: ${snapshot.focus}`);
  }
  
  // Counts
  lines.push(`Projects: ${snapshot.counts.active} active, ${snapshot.counts.shipped} shipped, ${snapshot.counts.total} total`);
  
  // Attention
  const attentionLabel = snapshot.patterns.attention_score >= 70 ? 'focused' 
    : snapshot.patterns.attention_score >= 40 ? 'moderate' 
    : 'scattered';
  lines.push(`Attention: ${attentionLabel} (${snapshot.patterns.attention_score}/100)`);
  
  // Top projects (brief)
  if (snapshot.top_projects.length > 0) {
    lines.push('Top projects:');
    for (const p of snapshot.top_projects) {
      const verdictStr = p.verdict ? ` [${p.verdict}]` : '';
      const daysStr = p.last_push_days_ago < 999 ? `, ${p.last_push_days_ago}d ago` : '';
      lines.push(`  - ${p.name}${verdictStr}${daysStr}`);
    }
  }
  
  // Last shipped
  if (snapshot.patterns.days_since_last_ship !== null) {
    lines.push(`Last shipped: ${snapshot.patterns.days_since_last_ship} days ago`);
  }
  
  return lines.join('\n');
}

