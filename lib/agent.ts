import Anthropic from '@anthropic-ai/sdk';
import { getContextualPrompt } from './personality.js';
import { stateManager, type ProjectState, type Commitment, type ConversationMessage } from './state.js';
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
    // Gather all context
    const projects = await this.gatherProjectStates();
    const commitments = await stateManager.getCommitments();
    const recentConversation = await stateManager.getRecentConversation(10);
    const currentTime = new Date().toISOString();

    // Build contextual prompt
    const prompt = getContextualPrompt({
      projects,
      commitments,
      recentConversation,
      currentTime,
    });

    // Add event-specific context if provided
    let userMessage = '';
    if (context?.userMessage) {
      userMessage = `\n\nUser just said: "${context.userMessage}"\n\nRespond to this directly and push them forward.`;
    } else if (context?.eventType === 'commit' && context.projectName) {
      userMessage = `\n\nA new commit was just pushed to ${context.projectName}. React to it - what's next?`;
    } else if (context?.eventType === 'deploy' && context.projectName) {
      userMessage = `\n\nA deployment just completed for ${context.projectName}. What should they test? What's missing?`;
    } else if (context?.eventType === 'stale') {
      userMessage = `\n\nYou're checking for stale projects. Call them out directly.`;
    } else if (context?.eventType === 'morning') {
      userMessage = `\n\nIt's morning. Give them a briefing of all projects and what they need to ship today.`;
    } else if (context?.eventType === 'midday') {
      userMessage = `\n\nIt's midday. Check progress on morning commitments. Push them.`;
    } else if (context?.eventType === 'afternoon') {
      userMessage = `\n\nIt's afternoon. Push hard on stale projects. What's shipping today?`;
    } else if (context?.eventType === 'evening') {
      userMessage = `\n\nIt's evening. Recap what got done. Set tomorrow's focus.`;
    }

    const fullPrompt = prompt + userMessage;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: fullPrompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        return content.text;
      }
      return 'Error generating response';
    } catch (error) {
      console.error('Anthropic API error:', error);
      return 'Error generating response. Check logs.';
    }
  }

  private async gatherProjectStates(): Promise<Array<{
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
    const githubRepos = await this.github.getUserRepos();
    const vercelProjects = await this.vercel.getProjects();

    // Sort by most recently pushed
    const sortedRepos = githubRepos.sort((a, b) => 
      new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime()
    );

    // Only process the 30 most recently active repos to avoid rate limits
    const activeRepos = sortedRepos.slice(0, 30);

    // Match GitHub repos to Vercel projects by name
    const projects = await Promise.all(
      activeRepos.map(async (repo) => {
        const [owner, name] = repo.full_name.split('/');
        const vercelProject = vercelProjects.find(p => 
          p.name === name || p.name === repo.full_name.replace('/', '-')
        );

        // Get latest commit
        let lastCommit: string | null = repo.pushed_at;
        let lastCommitMessage: string | null = null;
        try {
          const commit = await this.github.getLatestCommit(owner, name, repo.default_branch);
          if (commit) {
            lastCommit = commit.commit.author.date;
            lastCommitMessage = commit.commit.message.split('\n')[0]; // First line only
          }
        } catch (error) {
          // Use pushed_at as fallback
          lastCommit = repo.pushed_at;
        }

        // Get latest deployment - check for live URL
        let lastDeploy: string | null = null;
        let deployStatus: string | null = null;
        let previewUrl: string | null = null;
        
        // First check if repo has a homepage set (manual deploy URL)
        if (repo.homepage) {
          previewUrl = repo.homepage;
          deployStatus = 'ready';
        }
        
        // Then check Vercel
        if (vercelProject) {
          try {
            const deployment = await this.vercel.getLatestDeployment(vercelProject.id);
            if (deployment) {
              lastDeploy = new Date(deployment.createdAt).toISOString();
              deployStatus = deployment.state.toLowerCase();
              if (deployment.state === 'READY' && deployment.url) {
                previewUrl = `https://${deployment.url}`;
              }
            }
          } catch (error) {
            // Keep any existing previewUrl from homepage
          }
        }

        return {
          name,
          repo: repo.full_name,
          description: repo.description,
          lastCommit,
          lastCommitMessage,
          vercelProject: vercelProject?.name || null,
          lastDeploy,
          deployStatus,
          previewUrl,
        };
      })
    );

    return projects;
  }

  async syncProjectStates(): Promise<void> {
    const projects = await this.gatherProjectStates();
    
    for (const project of projects) {
      const existing = await stateManager.getProjectState(project.name);
      
      // Determine status based on deployment
      let status: 'idea' | 'building' | 'deployed' | 'launched' | 'validated' | 'abandoned' = 'idea';
      if (project.previewUrl && project.deployStatus === 'ready') {
        status = existing?.status === 'launched' || existing?.status === 'validated' 
          ? existing.status 
          : 'deployed';
      } else if (project.lastCommit) {
        status = 'building';
      }

      await stateManager.setProjectState(project.name, {
        repo: project.repo,
        description: project.description,
        lastCommit: project.lastCommit,
        lastCommitMessage: project.lastCommitMessage,
        vercelProject: project.vercelProject,
        lastDeploy: project.lastDeploy,
        deployStatus: project.deployStatus as 'ready' | 'building' | 'error' | null,
        previewUrl: project.previewUrl,
        // Preserve existing GTM data
        launchedAt: existing?.launchedAt || null,
        launchUrl: existing?.launchUrl || null,
        userFeedback: existing?.userFeedback || [],
        status,
      });
    }
  }
}

