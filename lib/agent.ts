import Anthropic from '@anthropic-ai/sdk';
import { getContextualPrompt } from './personality.js';
import { stateManager } from './state.js';
import { GitHubClient } from './github.js';
import { VercelClient } from './vercel.js';

export class Agent {
  private anthropic: Anthropic;
  private github: GitHubClient;
  private vercel: VercelClient;

  constructor(apiKey: string, githubToken: string, vercelToken: string, vercelTeamId?: string) {
    this.anthropic = new Anthropic({ apiKey });
    this.github = new GitHubClient(githubToken);
    this.vercel = new VercelClient(vercelToken, vercelTeamId);
  }

  async generateMessage(context?: {
    trigger?: 'cron' | 'webhook' | 'user_reply';
    eventType?: 'commit' | 'deploy' | 'stale' | 'morning' | 'midday' | 'afternoon' | 'evening';
    projectName?: string;
    userMessage?: string;
  }): Promise<string> {
    // Quick gather - just basic info, no deep API calls
    const projects = await this.quickGatherProjects();
    const commitments = await stateManager.getCommitments();
    const recentConversation = await stateManager.getRecentConversation(5);
    const currentTime = new Date().toISOString();

    const prompt = getContextualPrompt({
      projects,
      commitments,
      recentConversation,
      currentTime,
    });

    let userContext = '';
    if (context?.userMessage) {
      userContext = `\n\nUser said: "${context.userMessage}"`;
    } else if (context?.eventType === 'commit' && context.projectName) {
      userContext = `\n\nNew commit on ${context.projectName}. Push them to deploy it.`;
    } else if (context?.eventType === 'deploy' && context.projectName) {
      userContext = `\n\n${context.projectName} just deployed. Push them to share it.`;
    } else if (context?.eventType) {
      userContext = `\n\nTime-based check-in. Push on the most important thing.`;
    }

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200, // Short responses only
        messages: [{ role: 'user', content: prompt + userContext }],
      });

      const content = response.content[0];
      return content.type === 'text' ? content.text : 'Hey, what are you working on?';
    } catch (error) {
      console.error('AI error:', error);
      return "What's the one thing you're shipping today?";
    }
  }

  // Quick version - just gets repo list, no deep fetches
  private async quickGatherProjects(): Promise<Array<{
    name: string;
    repo: string;
    description: string | null;
    lastCommit: string | null;
    lastCommitMessage: string | null;
    vercelProject: string | null;
    lastDeploy: string | null;
    deployStatus: string | null;
    previewUrl: string | null;
  }>> {
    try {
      const [repos, vercelProjects] = await Promise.all([
        this.github.getUserRepos(),
        this.vercel.getProjects().catch(() => []),
      ]);

      // Just top 10, sorted by recent activity
      const recent = repos
        .sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime())
        .slice(0, 10);

      return recent.map(repo => {
        const vercel = vercelProjects.find(p => p.name === repo.name);
        return {
          name: repo.name,
          repo: repo.full_name,
          description: repo.description,
          lastCommit: repo.pushed_at,
          lastCommitMessage: null,
          vercelProject: vercel?.name || null,
          lastDeploy: null,
          deployStatus: null,
          previewUrl: repo.homepage || null,
        };
      });
    } catch (error) {
      console.error('Error gathering projects:', error);
      return [];
    }
  }

  // Full sync - only for cron jobs, not real-time
  async syncProjectStates(): Promise<void> {
    const projects = await this.quickGatherProjects();
    
    for (const project of projects) {
      const existing = await stateManager.getProjectState(project.name);
      
      await stateManager.setProjectState(project.name, {
        repo: project.repo,
        description: project.description,
        lastCommit: project.lastCommit,
        lastCommitMessage: project.lastCommitMessage,
        vercelProject: project.vercelProject,
        lastDeploy: project.lastDeploy,
        deployStatus: project.deployStatus as 'ready' | 'building' | 'error' | null,
        previewUrl: project.previewUrl,
        launchedAt: existing?.launchedAt || null,
        launchUrl: existing?.launchUrl || null,
        userFeedback: existing?.userFeedback || [],
        status: project.previewUrl ? 'deployed' : 'building',
      });
    }
  }
}
