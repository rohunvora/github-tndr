export interface VercelProject {
  id: string;
  name: string;
  updatedAt: number;
  framework: string | null;
  link?: {
    type: string;
    repo: string;
    repoId: number;
  };
}

export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: 'READY' | 'BUILDING' | 'ERROR' | 'QUEUED' | 'CANCELED';
  createdAt: number;
  readyAt: number | null;
  target: 'production' | 'preview' | null;
  error?: {
    message: string;
    code: string;
  };
}

export interface VercelEnvVar {
  id: string;
  key: string;
  target: string[];
  type: 'plain' | 'secret' | 'encrypted' | 'sensitive';
  createdAt: number;
}

export interface VercelDeploymentEvent {
  type: string;
  created: number;
  payload: {
    text?: string;
    statusCode?: number;
    path?: string;
  };
}

interface VercelProjectsResponse {
  projects: VercelProject[];
}

interface VercelDeploymentsResponse {
  deployments: VercelDeployment[];
}

interface VercelEnvVarsResponse {
  envs: VercelEnvVar[];
}

interface VercelEventsResponse {
  events: VercelDeploymentEvent[];
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

  private getQueryParams(extra: string = '') {
    const teamParam = this.teamId ? `teamId=${this.teamId}` : '';
    const params = [teamParam, extra].filter(Boolean).join('&');
    return params ? `?${params}` : '';
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

  async getProject(projectId: string): Promise<VercelProject | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v9/projects/${projectId}${this.getQueryParams()}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return null;
      }

      return await response.json() as VercelProject;
    } catch {
      return null;
    }
  }

  async getProjectDeployments(projectId: string, limit: number = 5): Promise<VercelDeployment[]> {
    const response = await fetch(
      `${this.baseUrl}/v6/deployments${this.getQueryParams(`projectId=${projectId}&limit=${limit}`)}`,
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

  async getLatestDeployment(projectId: string, target?: 'production' | 'preview'): Promise<VercelDeployment | null> {
    const deployments = await this.getProjectDeployments(projectId, 10);
    if (target) {
      return deployments.find(d => d.target === target) || null;
    }
    return deployments[0] || null;
  }

  async getDeploymentEvents(deploymentId: string): Promise<VercelDeploymentEvent[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v2/deployments/${deploymentId}/events${this.getQueryParams()}`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as VercelEventsResponse;
      return data.events || [];
    } catch {
      return [];
    }
  }

  async getDeploymentLogs(deploymentId: string): Promise<string> {
    const events = await this.getDeploymentEvents(deploymentId);
    
    // Filter for build and error events
    const relevantEvents = events
      .filter(e => e.payload?.text || e.type === 'error')
      .map(e => e.payload?.text || `[${e.type}]`)
      .slice(-50); // Last 50 log lines
    
    return relevantEvents.join('\n');
  }

  async getProjectEnvVars(projectId: string): Promise<VercelEnvVar[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v9/projects/${projectId}/env${this.getQueryParams()}`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as VercelEnvVarsResponse;
      return data.envs || [];
    } catch {
      return [];
    }
  }

  async getConfiguredEnvKeys(projectId: string, target: 'production' | 'preview' | 'development' = 'production'): Promise<string[]> {
    const envVars = await this.getProjectEnvVars(projectId);
    return envVars
      .filter(env => env.target.includes(target))
      .map(env => env.key);
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

  // Get the Vercel dashboard URL for env vars
  getEnvVarsUrl(projectName: string): string {
    const teamPath = this.teamId ? `${this.teamId}` : '';
    return `https://vercel.com/${teamPath}/${projectName}/settings/environment-variables`;
  }
}
