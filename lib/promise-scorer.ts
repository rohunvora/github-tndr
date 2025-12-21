import { GitHubRepo, GitHubClient } from './core/github.js';

export interface RepoPromiseScore {
  repo: GitHubRepo;
  score: number;
  breakdown: {
    fileCount: number;
    codeRatio: number;
    activity: number;
    readmeQuality: number;
    stars: number;
  };
  skipReason: string | null;
}

// Code file extensions
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.vue', '.svelte', '.astro',
]);

// Config/meta files to ignore in ratio calculation
const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.lock', '.md', '.txt', '.gitignore',
  '.env', '.example', '.config', '.rc',
]);

export async function scoreRepo(
  repo: GitHubRepo,
  github: GitHubClient
): Promise<RepoPromiseScore> {
  const [owner, name] = repo.full_name.split('/');
  
  // Fetch data in parallel
  const [fileTree, readme, commitSignals] = await Promise.all([
    github.getRepoTree(owner, name, 200),
    github.getFileContent(owner, name, 'README.md'),
    github.getCommitSignals(owner, name),
  ]);

  // 1. File count score (0-30)
  // More files = more substantial project
  const fileCount = fileTree.length;
  let fileCountScore = 0;
  if (fileCount >= 50) fileCountScore = 30;
  else if (fileCount >= 30) fileCountScore = 25;
  else if (fileCount >= 15) fileCountScore = 20;
  else if (fileCount >= 8) fileCountScore = 15;
  else if (fileCount >= 4) fileCountScore = 10;
  else if (fileCount >= 2) fileCountScore = 5;

  // 2. Code ratio score (0-20)
  // Higher ratio of code files vs config = more substantive
  const codeFiles = fileTree.filter(f => {
    const ext = '.' + f.split('.').pop()?.toLowerCase();
    return CODE_EXTENSIONS.has(ext);
  }).length;
  const configFiles = fileTree.filter(f => {
    const ext = '.' + f.split('.').pop()?.toLowerCase();
    return CONFIG_EXTENSIONS.has(ext);
  }).length;
  const totalCounted = codeFiles + configFiles;
  const codeRatio = totalCounted > 0 ? codeFiles / totalCounted : 0;
  let codeRatioScore = Math.round(codeRatio * 20);

  // 3. Activity score (0-25)
  // Recent, coherent commits = active development
  let activityScore = 0;
  if (commitSignals.velocity === 'active') activityScore += 15;
  else if (commitSignals.days_since_last <= 30) activityScore += 10;
  else if (commitSignals.days_since_last <= 90) activityScore += 5;
  
  if (commitSignals.coherence === 'focused') activityScore += 10;
  else activityScore += 3;

  // 4. README quality score (0-15)
  let readmeQualityScore = 0;
  if (readme) {
    const readmeLength = readme.length;
    if (readmeLength >= 2000) readmeQualityScore = 15;
    else if (readmeLength >= 1000) readmeQualityScore = 12;
    else if (readmeLength >= 500) readmeQualityScore = 8;
    else if (readmeLength >= 100) readmeQualityScore = 5;
    else readmeQualityScore = 2;
  }

  // 5. Stars score (0-10)
  let starsScore = 0;
  if (repo.stargazers_count >= 100) starsScore = 10;
  else if (repo.stargazers_count >= 50) starsScore = 8;
  else if (repo.stargazers_count >= 10) starsScore = 6;
  else if (repo.stargazers_count >= 5) starsScore = 4;
  else if (repo.stargazers_count >= 1) starsScore = 2;

  const totalScore = fileCountScore + codeRatioScore + activityScore + readmeQualityScore + starsScore;

  // Determine skip reason
  let skipReason: string | null = null;
  if (fileCount < 3) {
    skipReason = 'Too few files (< 3)';
  } else if (codeFiles === 0) {
    skipReason = 'No code files detected';
  } else if (totalScore < 30) {
    skipReason = `Low promise score (${totalScore})`;
  }

  return {
    repo,
    score: totalScore,
    breakdown: {
      fileCount: fileCountScore,
      codeRatio: codeRatioScore,
      activity: activityScore,
      readmeQuality: readmeQualityScore,
      stars: starsScore,
    },
    skipReason,
  };
}

export async function scoreAndSortRepos(
  repos: GitHubRepo[],
  github: GitHubClient,
  onProgress?: (completed: number, total: number, current: string) => void
): Promise<RepoPromiseScore[]> {
  const scores: RepoPromiseScore[] = [];
  
  // Process in batches of 5 for rate limiting
  for (let i = 0; i < repos.length; i += 5) {
    const batch = repos.slice(i, i + 5);
    const batchScores = await Promise.all(
      batch.map(async (repo) => {
        try {
          const score = await scoreRepo(repo, github);
          onProgress?.(scores.length + 1, repos.length, repo.name);
          return score;
        } catch (error) {
          onProgress?.(scores.length + 1, repos.length, repo.name);
          return {
            repo,
            score: 0,
            breakdown: { fileCount: 0, codeRatio: 0, activity: 0, readmeQuality: 0, stars: 0 },
            skipReason: `Error: ${error instanceof Error ? error.message : 'Unknown'}`,
          };
        }
      })
    );
    scores.push(...batchScores);
  }

  // Sort by score descending
  return scores.sort((a, b) => b.score - a.score);
}
