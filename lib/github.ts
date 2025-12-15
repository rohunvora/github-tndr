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
      throw new Error(`GitHub API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data as T;
  }

  async getUserRepos(): Promise<GitHubRepo[]> {
    const repos = await this.request<GitHubRepo[]>('/user/repos?sort=updated&per_page=100');
    return repos.filter(repo => !repo.name.includes('.github'));
  }

  async getRepoCommits(owner: string, repo: string, branch: string = 'main'): Promise<GitHubCommit[]> {
    return this.request<GitHubCommit[]>(`/repos/${owner}/${repo}/commits?sha=${branch}&per_page=10`);
  }

  async getLatestCommit(owner: string, repo: string, branch: string = 'main'): Promise<GitHubCommit | null> {
    const commits = await this.getRepoCommits(owner, repo, branch);
    return commits[0] || null;
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
