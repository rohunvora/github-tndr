export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  updated_at: string;
  pushed_at: string;
  default_branch: string;
  homepage: string | null;
  topics: string[];
  private: boolean;
  stargazers_count: number;
  size: number;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: { date: string };
  };
}

interface GitHubFileContent {
  content: string;
  encoding: string;
}

export class GitHubClient {
  private token: string;
  private baseUrl = 'https://api.github.com';

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        Authorization: `token ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  }

  async getUserRepos(): Promise<GitHubRepo[]> {
    const repos = await this.request<GitHubRepo[]>('/user/repos?sort=pushed&per_page=100');
    return repos.filter(repo => !repo.name.includes('.github'));
  }

  async getRepoCommits(owner: string, repo: string): Promise<GitHubCommit[]> {
    return this.request<GitHubCommit[]>(`/repos/${owner}/${repo}/commits?per_page=5`);
  }

  async getFileContent(owner: string, repo: string, path: string): Promise<string | null> {
    try {
      const data = await this.request<GitHubFileContent>(`/repos/${owner}/${repo}/contents/${path}`);
      if (data.encoding === 'base64' && data.content) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      return null;
    } catch {
      return null;
    }
  }

  async getRepoTree(owner: string, repo: string, maxFiles = 100): Promise<string[]> {
    try {
      const repoInfo = await this.request<{ default_branch: string }>(`/repos/${owner}/${repo}`);
      const tree = await this.request<{ tree: Array<{ path: string; type: string }> }>(
        `/repos/${owner}/${repo}/git/trees/${repoInfo.default_branch}?recursive=1`
      );
      return tree.tree.filter(item => item.type === 'blob').map(item => item.path).slice(0, maxFiles);
    } catch {
      return [];
    }
  }

  async getRepoInfo(owner: string, repo: string): Promise<{
    description: string | null;
    stars: number;
    default_branch: string;
    homepage: string | null;
    pushed_at: string;
    created_at: string;
  } | null> {
    try {
      const data = await this.request<{
        description: string | null;
        stargazers_count: number;
        default_branch: string;
        homepage: string | null;
        pushed_at: string;
        created_at: string;
      }>(`/repos/${owner}/${repo}`);
      return {
        description: data.description,
        stars: data.stargazers_count,
        default_branch: data.default_branch,
        homepage: data.homepage,
        pushed_at: data.pushed_at,
        created_at: data.created_at,
      };
    } catch {
      return null;
    }
  }

  analyzeCommitCoherence(messages: string[]): 'focused' | 'chaotic' {
    if (messages.length === 0) return 'chaotic';
    const focusedCount = messages.filter(m =>
      /^(feat|fix|refactor|docs|chore|test|style|perf|ci|build)(\(.+\))?:/i.test(m) || m.length > 30
    ).length;
    const chaoticCount = messages.filter(m =>
      /\b(wip|debug|temp|trash|delete|remove|revert|asdf|test123)\b/i.test(m) || m.length < 10
    ).length;
    return chaoticCount > focusedCount ? 'chaotic' : 'focused';
  }

  async getCommitSignals(owner: string, repo: string): Promise<{
    velocity: 'active' | 'stale';
    coherence: 'focused' | 'chaotic';
    days_since_last: number;
    recent_messages: string[];
  }> {
    try {
      const commits = await this.getRepoCommits(owner, repo);
      if (commits.length === 0) {
        return { velocity: 'stale', coherence: 'chaotic', days_since_last: 999, recent_messages: [] };
      }
      const messages = commits.map(c => c.commit.message.split('\n')[0]);
      const daysSince = Math.floor((Date.now() - new Date(commits[0].commit.author.date).getTime()) / 86400000);
      return {
        velocity: daysSince <= 7 ? 'active' : 'stale',
        coherence: this.analyzeCommitCoherence(messages),
        days_since_last: daysSince,
        recent_messages: messages.slice(0, 5),
      };
    } catch {
      return { velocity: 'stale', coherence: 'chaotic', days_since_last: 999, recent_messages: [] };
    }
  }

  async getRecentRepos(days = 10): Promise<GitHubRepo[]> {
    const allRepos = await this.getUserRepos();
    const cutoff = Date.now() - days * 86400000;
    return allRepos.filter(repo => new Date(repo.pushed_at).getTime() >= cutoff);
  }

  async getPublicRepos(days = 150): Promise<GitHubRepo[]> {
    // Fetch multiple pages to get enough repos for 150 days
    const allRepos: GitHubRepo[] = [];
    const cutoff = Date.now() - days * 86400000;
    
    for (let page = 1; page <= 3; page++) {
      const repos = await this.request<GitHubRepo[]>(
        `/user/repos?sort=pushed&per_page=100&page=${page}&visibility=public`
      );
      if (repos.length === 0) break;
      
      const filtered = repos.filter(repo => 
        !repo.name.includes('.github') && 
        !repo.private &&
        new Date(repo.pushed_at).getTime() >= cutoff
      );
      allRepos.push(...filtered);
      
      // If the last repo is older than cutoff, we have enough
      if (repos.length < 100 || new Date(repos[repos.length - 1].pushed_at).getTime() < cutoff) {
        break;
      }
    }
    
    return allRepos;
  }

  async getOwnedRepos(days = 150, includePrivate = true): Promise<GitHubRepo[]> {
    // Fetch repos where user is the owner (public + private with no collaborators)
    const allRepos: GitHubRepo[] = [];
    const cutoff = Date.now() - days * 86400000;
    
    for (let page = 1; page <= 5; page++) {
      const repos = await this.request<GitHubRepo[]>(
        `/user/repos?sort=pushed&per_page=100&page=${page}&affiliation=owner`
      );
      if (repos.length === 0) break;
      
      for (const repo of repos) {
        // Skip .github repos and repos older than cutoff
        if (repo.name.includes('.github')) continue;
        if (new Date(repo.pushed_at).getTime() < cutoff) continue;
        
        // For private repos, check if there are collaborators
        if (repo.private && includePrivate) {
          try {
            const collaborators = await this.request<Array<{ id: number }>>(
              `/repos/${repo.full_name}/collaborators?per_page=10`
            );
            // If more than 1 collaborator (just the owner), skip
            if (collaborators.length > 1) continue;
          } catch {
            // If we can't check collaborators, skip to be safe
            continue;
          }
        }
        
        allRepos.push(repo);
      }
      
      // If the last repo is older than cutoff, we have enough
      if (repos.length < 100 || new Date(repos[repos.length - 1].pushed_at).getTime() < cutoff) {
        break;
      }
    }
    
    return allRepos;
  }
}
