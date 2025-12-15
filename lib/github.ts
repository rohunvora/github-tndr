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
}
