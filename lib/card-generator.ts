import Anthropic from '@anthropic-ai/sdk';
import { kv } from '@vercel/kv';
import { TrackedRepo, RepoCard, RepoPotential, FeedMemory } from './core/types.js';
import { generateRepoPotential, generateLastContext, generateNextStep } from './ai/index.js';
import { computeProjectStage, getDeployState, computePackagingChecks, parseReadmeTodos, getDaysSince, isNewDay } from './deterministic-checks.js';
import { GitHubClient } from './core/github.js';

// Progress callback for streaming UI updates
export type CardProgressStep =
  | 'selecting'      // Choosing which repo
  | 'loading'        // Loading repo data
  | 'analyzing'      // Getting potential (may be cached)
  | 'context'        // Getting last context
  | 'next_step'      // Determining next step
  | 'complete';      // Done

export interface CardProgress {
  step: CardProgressStep;
  repoName?: string;
  stage?: string;
  potential?: string;
  error?: string;
}

export type OnProgressCallback = (progress: CardProgress) => Promise<void>;

// Cache keys
const POTENTIAL_PREFIX = 'potential:';
const FEED_MEMORY_KEY = 'feed:memory';

/**
 * Get or generate repo potential (cached)
 */
async function getCachedPotential(
  anthropic: Anthropic,
  repo: TrackedRepo,
  readme: string | null,
  techStack: string[]
): Promise<RepoPotential> {
  const cacheKey = `${POTENTIAL_PREFIX}${repo.owner}/${repo.name}`;
  
  // Check cache
  const cached = await kv.get<RepoPotential>(cacheKey);
  if (cached) return cached;
  
  // Generate new potential
  const potential = await generateRepoPotential(anthropic, {
    repo_name: repo.name,
    repo_description: repo.analysis?.one_liner || '',
    readme_excerpt: (readme || '').slice(0, 2000),
    tech_stack: techStack,
  });
  
  // Cache for 7 days
  await kv.set(cacheKey, potential, { ex: 7 * 24 * 60 * 60 });
  
  return potential;
}

/**
 * Get feed memory, reset if new day
 */
export async function getFeedMemory(): Promise<FeedMemory> {
  const memory = await kv.get<FeedMemory>(FEED_MEMORY_KEY);
  
  if (!memory || isNewDay(memory.last_reset)) {
    // Reset for new day, but keep intentions
    const newMemory: FeedMemory = {
      shown_today: [],
      skipped_today: [],
      active_card: null,
      last_reset: new Date().toISOString(),
      intentions: memory?.intentions || {},
    };
    await kv.set(FEED_MEMORY_KEY, newMemory);
    return newMemory;
  }
  
  return memory;
}

/**
 * Update feed memory
 */
export async function updateFeedMemory(updates: Partial<FeedMemory>): Promise<FeedMemory> {
  const current = await getFeedMemory();
  const updated = { ...current, ...updates };
  await kv.set(FEED_MEMORY_KEY, updated);
  return updated;
}

/**
 * Mark a card as shown
 */
export async function markCardShown(fullName: string): Promise<void> {
  const memory = await getFeedMemory();
  if (!memory.shown_today.includes(fullName)) {
    memory.shown_today.push(fullName);
  }
  memory.active_card = fullName;
  await kv.set(FEED_MEMORY_KEY, memory);
}

/**
 * Mark a card as skipped
 */
export async function markCardSkipped(fullName: string): Promise<void> {
  const memory = await getFeedMemory();
  if (!memory.skipped_today.includes(fullName)) {
    memory.skipped_today.push(fullName);
  }
  memory.active_card = null;
  await kv.set(FEED_MEMORY_KEY, memory);
}

/**
 * Get active intention for a repo
 */
export async function getActiveIntention(fullName: string): Promise<{ action: string; stated_at: string } | undefined> {
  const memory = await getFeedMemory();
  const intention = memory.intentions[fullName];
  if (!intention) return undefined;
  
  // Check if intention is still valid (not expired)
  const remindAfter = new Date(intention.remind_after);
  if (new Date() < remindAfter) {
    return undefined; // Not time yet
  }
  
  return { action: intention.action, stated_at: intention.stated_at };
}

/**
 * Save an intention
 */
export async function saveIntention(
  fullName: string, 
  action: string, 
  remindInHours: number = 24
): Promise<void> {
  const memory = await getFeedMemory();
  memory.intentions[fullName] = {
    action,
    stated_at: new Date().toISOString(),
    remind_after: new Date(Date.now() + remindInHours * 60 * 60 * 1000).toISOString(),
  };
  await kv.set(FEED_MEMORY_KEY, memory);
}

/**
 * Clear an intention
 */
export async function clearIntention(fullName: string): Promise<void> {
  const memory = await getFeedMemory();
  delete memory.intentions[fullName];
  await kv.set(FEED_MEMORY_KEY, memory);
}

/**
 * Calculate priority score for a repo
 */
export function calculatePriority(repo: TrackedRepo, memory: FeedMemory): number {
  let score = 0;
  const fullName = `${repo.owner}/${repo.name}`;
  
  // Stated intentions = highest priority (+100)
  if (memory.intentions[fullName]) {
    const intention = memory.intentions[fullName];
    const remindAfter = new Date(intention.remind_after);
    if (new Date() >= remindAfter) {
      score += 100;
    }
  }
  
  // Ready to launch = high priority (+80)
  const stage = computeProjectStage(repo);
  if (stage === 'ready_to_launch') score += 80;
  else if (stage === 'packaging') score += 40;
  
  // Recent momentum
  const daysSincePush = getDaysSince(repo.last_push_at);
  if (daysSincePush < 3) score += 50;
  else if (daysSincePush < 7) score += 30;
  else if (daysSincePush < 14) score += 10;
  
  // Analysis quality bonus
  if (repo.analysis?.has_core) score += 20;
  if (repo.analysis?.tweet_draft) score += 10;
  
  // Penalize if shown/skipped today
  if (memory.shown_today.includes(fullName)) score -= 200;
  if (memory.skipped_today.includes(fullName)) score -= 50;
  
  // Penalize dead/shipped repos heavily
  if (repo.state === 'dead') score -= 500;
  if (repo.state === 'shipped') score -= 300;
  
  return score;
}

/**
 * Generate a full RepoCard for a repo
 * @param onProgress - Optional callback for streaming progress updates
 */
export async function generateCard(
  anthropic: Anthropic,
  github: GitHubClient,
  repo: TrackedRepo,
  onProgress?: OnProgressCallback
): Promise<RepoCard> {
  const fullName = `${repo.owner}/${repo.name}`;
  const progress = onProgress || (async () => {});

  // Step: Loading repo data
  await progress({ step: 'loading', repoName: repo.name });

  // Fetch README and determine tech stack
  const [readme, packageJson, commits] = await Promise.all([
    github.getFileContent(repo.owner, repo.name, 'README.md'),
    github.getFileContent(repo.owner, repo.name, 'package.json'),
    github.getRepoCommits(repo.owner, repo.name).catch(() => []),
  ]);

  // Parse tech stack from package.json
  const techStack: string[] = [];
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react) techStack.push('React');
      if (deps.next) techStack.push('Next.js');
      if (deps.vue) techStack.push('Vue');
      if (deps.express) techStack.push('Express');
      if (deps.typescript) techStack.push('TypeScript');
    } catch { /* ignore */ }
  }

  // 2. Compute deterministic state (fast, no AI)
  const deployState = getDeployState(repo);
  const stage = computeProjectStage(repo);
  const packagingChecks = computePackagingChecks(repo);
  const readmeTodos = parseReadmeTodos(readme);

  // Step: Analyzing potential
  await progress({ step: 'analyzing', repoName: repo.name, stage });

  // 1. Get potential (cached or generate)
  const potential = await getCachedPotential(anthropic, repo, readme, techStack);

  // Step: Getting context
  await progress({ step: 'context', repoName: repo.name, stage, potential: potential.potential });

  // 3. Get last context
  const recentCommits = commits.slice(0, 5).map(c => ({
    sha: c.sha,
    message: c.commit.message,
    files_changed: [], // Would need another API call for full diff
  }));

  const intention = await getActiveIntention(fullName);
  const lastContext = await generateLastContext(anthropic, {
    recent_commits: recentCommits,
    open_intention: intention,
  });

  // Step: Determining next step
  await progress({ step: 'next_step', repoName: repo.name, stage, potential: potential.potential });

  // 4. Get next step
  const nextStep = await generateNextStep(anthropic, {
    readme_todos: readmeTodos,
    stated_intention: intention,
    deploy_state: deployState,
    packaging_checks: packagingChecks,
    project_stage: stage,
    recent_activity_summary: lastContext.last_context,
    potential,
  });
  
  // 5. Calculate priority
  const memory = await getFeedMemory();
  const priority = calculatePriority(repo, memory);
  
  // 6. Build card
  // Cover image: Use wsrv.nl proxy to resize our generated social-preview.png
  // The proxy also handles 404s gracefully by returning a placeholder
  const rawImageUrl = `https://raw.githubusercontent.com/${fullName}/main/.github/social-preview.png`;
  // wsrv.nl resizes images on the fly - 1200x630 is optimal for social previews
  // default=1 returns GitHub's default image if the file 404s
  const coverUrl = `https://wsrv.nl/?url=${encodeURIComponent(rawImageUrl)}&w=1200&h=630&fit=cover&output=jpg&q=85&default=${encodeURIComponent(`https://opengraph.githubassets.com/1/${fullName}`)}`;
  
  return {
    repo: repo.name,
    full_name: fullName,
    cover_image_url: coverUrl,
    homepage: repo.homepage || null,
    potential,
    last_context: lastContext,
    next_step: nextStep,
    priority_score: priority,
    stage,
  };
}

/**
 * Get the next card to show (highest priority repo not yet shown today)
 * @param onProgress - Optional callback for streaming progress updates
 */
export async function getNextCard(
  anthropic: Anthropic,
  github: GitHubClient,
  repos: TrackedRepo[],
  onProgress?: OnProgressCallback
): Promise<RepoCard | null> {
  const progress = onProgress || (async () => {});

  // Step: Selecting repo
  await progress({ step: 'selecting' });

  const memory = await getFeedMemory();

  // Filter out shipped/dead and sort by priority
  const candidates = repos
    .filter(r => r.state !== 'shipped' && r.state !== 'dead')
    .map(r => ({ repo: r, priority: calculatePriority(r, memory) }))
    .sort((a, b) => b.priority - a.priority);

  if (candidates.length === 0) return null;

  // Get the highest priority repo
  const best = candidates[0];
  if (best.priority < -100) {
    // All repos have been shown/skipped today
    return null;
  }

  // Generate the full card with progress
  return generateCard(anthropic, github, best.repo, onProgress);
}
