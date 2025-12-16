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
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      date: string;
    };
  };
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

export interface GitHubFileContent {
  name: string;
  path: string;
  content: string; // base64 encoded
  encoding: string;
}

export class GitHubClient {
  private token: string;
  private baseUrl = 'https://api.github.com';

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `token ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Not found: ${endpoint}`);
      }
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data as T;
  }

  async getUserRepos(): Promise<GitHubRepo[]> {
    const repos = await this.request<GitHubRepo[]>('/user/repos?sort=pushed&per_page=100');
    return repos.filter(repo => !repo.name.includes('.github'));
  }

  async getRepoCommits(owner: string, repo: string, branch?: string): Promise<GitHubCommit[]> {
    const sha = branch ? `&sha=${branch}` : '';
    return this.request<GitHubCommit[]>(`/repos/${owner}/${repo}/commits?per_page=5${sha}`);
  }

  async getCommitWithDiff(owner: string, repo: string, sha: string): Promise<GitHubCommit> {
    return this.request<GitHubCommit>(`/repos/${owner}/${repo}/commits/${sha}`);
  }

  async getLatestCommit(owner: string, repo: string, branch: string = 'main'): Promise<GitHubCommit | null> {
    try {
      const commits = await this.getRepoCommits(owner, repo, branch);
      return commits[0] || null;
    } catch {
      return null;
    }
  }

  async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string | null> {
    try {
      const refParam = ref ? `?ref=${ref}` : '';
      const data = await this.request<GitHubFileContent>(`/repos/${owner}/${repo}/contents/${path}${refParam}`);
      
      if (data.encoding === 'base64' && data.content) {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      return null;
    } catch {
      return null;
    }
  }

  async getMultipleFiles(
    owner: string,
    repo: string,
    paths: string[],
    ref?: string
  ): Promise<Record<string, string | null>> {
    const results: Record<string, string | null> = {};
    
    await Promise.all(
      paths.map(async (path) => {
        results[path] = await this.getFileContent(owner, repo, path, ref);
      })
    );
    
    return results;
  }

  // Search for files that might contain env var references
  async searchEnvReferences(owner: string, repo: string): Promise<string[]> {
    try {
      // Search for process.env usage
      const response = await this.request<{ items: Array<{ path: string }> }>(
        `/search/code?q=process.env+repo:${owner}/${repo}&per_page=20`
      );
      return response.items?.map(item => item.path) || [];
    } catch {
      return [];
    }
  }

  async createIssue(owner: string, repo: string, title: string, body: string): Promise<void> {
    await fetch(`${this.baseUrl}/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `token ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body }),
    });
  }

  // ============ NEW METHODS FOR SHIP OR KILL BOT ============

  /**
   * Get the full file tree of a repository (recursive)
   */
  async getRepoTree(owner: string, repo: string, maxFiles: number = 100): Promise<string[]> {
    try {
      // First get the default branch
      const repoInfo = await this.request<{ default_branch: string }>(`/repos/${owner}/${repo}`);
      const branch = repoInfo.default_branch;

      // Get the tree
      const tree = await this.request<{
        tree: Array<{ path: string; type: string }>;
        truncated: boolean;
      }>(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);

      // Filter to files only (not directories), limit count
      const files = tree.tree
        .filter(item => item.type === 'blob')
        .map(item => item.path)
        .slice(0, maxFiles);

      return files;
    } catch (error) {
      console.error(`Failed to fetch tree for ${owner}/${repo}:`, error);
      return [];
    }
  }

  /**
   * Get repository info (description, stars, etc.)
   */
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
    } catch (error) {
      console.error(`Failed to fetch repo info for ${owner}/${repo}:`, error);
      return null;
    }
  }

  /**
   * Analyze commit message patterns for coherence signal
   */
  analyzeCommitCoherence(messages: string[]): 'focused' | 'chaotic' {
    if (messages.length === 0) return 'chaotic';

    // Count focused patterns (conventional commits, clear descriptions)
    const focusedCount = messages.filter(m =>
      /^(feat|fix|refactor|docs|chore|test|style|perf|ci|build)(\(.+\))?:/i.test(m) ||
      m.length > 30
    ).length;

    // Count chaotic patterns (wip, debug, temp, etc.)
    const chaoticCount = messages.filter(m =>
      /\b(wip|debug|temp|trash|delete|remove|revert|asdf|test123)\b/i.test(m) ||
      m.length < 10
    ).length;

    // If chaotic signals dominate, it's chaotic
    if (chaoticCount > focusedCount) return 'chaotic';
    return 'focused';
  }

  /**
   * Get commit signals (velocity, coherence, recency)
   */
  async getCommitSignals(owner: string, repo: string): Promise<{
    velocity: 'active' | 'stale';
    coherence: 'focused' | 'chaotic';
    days_since_last: number;
    recent_messages: string[];
  }> {
    try {
      const commits = await this.getRepoCommits(owner, repo);
      
      if (commits.length === 0) {
        return {
          velocity: 'stale',
          coherence: 'chaotic',
          days_since_last: 999,
          recent_messages: [],
        };
      }

      const messages = commits.map(c => c.commit.message.split('\n')[0]);
      const lastCommitDate = new Date(commits[0].commit.author.date);
      const daysSince = Math.floor((Date.now() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24));

      return {
        velocity: daysSince <= 7 ? 'active' : 'stale',
        coherence: this.analyzeCommitCoherence(messages),
        days_since_last: daysSince,
        recent_messages: messages.slice(0, 5),
      };
    } catch (error) {
      console.error(`Failed to get commit signals for ${owner}/${repo}:`, error);
      return {
        velocity: 'stale',
        coherence: 'chaotic',
        days_since_last: 999,
        recent_messages: [],
      };
    }
  }

  /**
   * Get recent repos for a user (for /scan command)
   */
  async getRecentRepos(days: number = 10): Promise<GitHubRepo[]> {
    const allRepos = await this.getUserRepos();
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return allRepos.filter(repo => {
      const pushedAt = new Date(repo.pushed_at);
      return pushedAt >= cutoffDate;
    });
  }
}
