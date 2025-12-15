export interface VercelProject {
  id: string;
  name: string;
  updatedAt: number;
}

export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: 'READY' | 'BUILDING' | 'ERROR' | 'QUEUED' | 'CANCELED';
  createdAt: number;
  readyAt: number | null;
  error?: {
    message: string;
  };
}

interface VercelProjectsResponse {
  projects: VercelProject[];
}

interface VercelDeploymentsResponse {
  deployments: VercelDeployment[];
}

interface VercelErrorResponse {
  error?: {
    message?: string;
  };
}

export class VercelClient {
  private token: string;
  private teamId: string | null;
  private baseUrl = 'https://api.vercel.com';

  constructor(token: string, teamId?: string) {
    this.token = token;
    this.teamId = teamId || null;
  }

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private getQueryParams() {
    return this.teamId ? `?teamId=${this.teamId}` : '';
  }

  async getProjects(): Promise<VercelProject[]> {
    const response = await fetch(`${this.baseUrl}/v9/projects${this.getQueryParams()}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Vercel API error: ${response.statusText}`);
    }

    const data = await response.json() as VercelProjectsResponse;
    return data.projects || [];
  }

  async getProjectDeployments(projectId: string, limit: number = 5): Promise<VercelDeployment[]> {
    const response = await fetch(
      `${this.baseUrl}/v6/deployments${this.getQueryParams()}&projectId=${projectId}&limit=${limit}`,
      {
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`Vercel API error: ${response.statusText}`);
    }

    const data = await response.json() as VercelDeploymentsResponse;
    return data.deployments || [];
  }

  async getLatestDeployment(projectId: string): Promise<VercelDeployment | null> {
    const deployments = await this.getProjectDeployments(projectId, 1);
    return deployments[0] || null;
  }

  async createDeployment(projectId: string, branch: string = 'main'): Promise<VercelDeployment> {
    const response = await fetch(`${this.baseUrl}/v13/deployments${this.getQueryParams()}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        name: projectId,
        gitSource: {
          type: 'github',
          repo: projectId,
          ref: branch,
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json() as VercelErrorResponse;
      throw new Error(`Vercel deployment error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json() as VercelDeployment;
    return data;
  }
}
