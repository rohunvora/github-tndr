import Anthropic from '@anthropic-ai/sdk';
import { ProjectSnapshot } from './collector.js';
import { EvidenceRef, GTMStage, NextAction, Shortcoming, ActionType } from './types.js';
import { UserProfile } from './profile.js';

// ============ PROJECT ASSESSMENT ============

export interface ProjectAssessment {
  projectName: string;
  gtmStage: GTMStage;
  
  // Action type (forced choice)
  actionType: ActionType;
  
  // The ONE next action
  nextAction: NextAction;
  
  // Top shortcoming (already computed by collector, but reasoner can refine)
  primaryShortcoming: Shortcoming | null;
  
  // Should we auto-message?
  shouldAutoMessage: boolean;
  autoMessageReason: string;
  
  // Generated artifacts
  artifacts: {
    cursorPrompt: string | null;
    launchPost: string | null;
    landingCopy: string | null;
    envChecklist: string | null;
  };
}

// ============ REASONER ============

export class Reasoner {
  private anthropic: Anthropic;
  private vercelTeamId: string | null;

  constructor(apiKey: string, vercelTeamId?: string) {
    this.anthropic = new Anthropic({ apiKey });
    this.vercelTeamId = vercelTeamId || null;
  }

  async analyze(
    snapshot: ProjectSnapshot,
    userProfile?: UserProfile
  ): Promise<ProjectAssessment> {
    // Step 1: Determine action type based on GTM stage
    const actionType = this.determineActionType(snapshot);

    // Step 2: Pick the primary shortcoming (operational takes priority)
    const primaryShortcoming = snapshot.operationalBlocker || snapshot.gtmBlocker;

    // Step 3: Determine next action
    const nextAction = this.determineNextAction(snapshot, actionType, primaryShortcoming);

    // Step 4: Should we auto-message?
    const { shouldAutoMessage, reason } = this.shouldAutoMessage(snapshot, primaryShortcoming);

    // Step 5: Generate artifacts based on action type
    const artifacts = await this.generateArtifacts(snapshot, nextAction, userProfile);

    return {
      projectName: snapshot.name,
      gtmStage: snapshot.gtmStage,
      actionType,
      nextAction,
      primaryShortcoming,
      shouldAutoMessage,
      autoMessageReason: reason,
      artifacts,
    };
  }

  async analyzeWithFeedback(
    snapshot: ProjectSnapshot,
    userProfile: UserProfile | undefined,
    feedback: { tractionSignal: string | null; featureRequest: string | null }
  ): Promise<ProjectAssessment> {
    // Force stage to post_launch
    const assessment = await this.analyze(snapshot, userProfile);
    assessment.gtmStage = 'post_launch';
    
    // If there's a feature request, generate cursor prompt for it
    if (feedback.featureRequest) {
      assessment.nextAction = {
        action: `Add ${feedback.featureRequest}`,
        actionType: 'build',
        rationale: 'Users are requesting this feature',
        effort: 'medium',
        artifact: 'cursor_prompt',
        evidence: [],
      };
      
      assessment.artifacts.cursorPrompt = await this.generateFeaturePrompt(
        snapshot,
        feedback.featureRequest
      );
    }
    
    return assessment;
  }

  private async generateFeaturePrompt(
    snapshot: ProjectSnapshot,
    feature: string
  ): Promise<string> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Generate a Cursor AI prompt to add "${feature}" to ${snapshot.name}.

Project type: ${snapshot.type}
Recent files: ${snapshot.recentlyChangedFiles.slice(0, 5).join(', ')}

The prompt should:
1. State the specific feature to add
2. List likely target files based on project structure
3. Include acceptance criteria
4. Be copy-paste ready

Format as a code block.`
        }],
      });
      
      const content = response.content[0];
      return content.type === 'text' ? content.text : this.fallbackFeaturePrompt(snapshot, feature);
    } catch {
      return this.fallbackFeaturePrompt(snapshot, feature);
    }
  }

  private fallbackFeaturePrompt(snapshot: ProjectSnapshot, feature: string): string {
    return `\`\`\`
In ${snapshot.name}:

Add ${feature}

Based on user feedback requesting this feature.

Target files: ${snapshot.recentlyChangedFiles.slice(0, 3).join(', ') || 'Check recent changes'}

Acceptance criteria:
- [ ] ${feature} is implemented
- [ ] Works on desktop and mobile  
- [ ] Deploy succeeds
\`\`\``;
  }

  private determineActionType(snapshot: ProjectSnapshot): ActionType {
    // If there's an operational blocker, it's a BUILD action
    if (snapshot.operationalBlocker && snapshot.operationalBlocker.severity === 'critical') {
      return 'build';
    }

    // If GTM stage is building, it's BUILD
    if (snapshot.gtmStage === 'building') {
      return 'build';
    }

    // Otherwise, aggressively switch to GTM
    return 'gtm';
  }

  private determineNextAction(
    snapshot: ProjectSnapshot,
    actionType: ActionType,
    shortcoming: Shortcoming | null
  ): NextAction {
    // BUILD actions
    if (actionType === 'build') {
      // Check missing env vars FIRST (higher priority than generic deploy error)
      if (snapshot.missingEnvVars.length > 0) {
        const critical = snapshot.missingEnvVars.filter(v => 
          v.includes('API_KEY') || v.includes('SECRET') || v.includes('TOKEN')
        );
        return {
          action: `Add ${critical.length || snapshot.missingEnvVars.length} missing env var${snapshot.missingEnvVars.length > 1 ? 's' : ''}`,
          actionType: 'build',
          rationale: critical.length > 0 ? 'Critical API keys needed' : 'Required configuration missing',
          effort: 'small',
          artifact: 'env_checklist',
          evidence: shortcoming?.evidence || [],
        };
      }

      if (snapshot.deployment.status === 'error') {
        return {
          action: `Fix deploy error: ${snapshot.deployment.errorCategory || 'unknown'} issue`,
          actionType: 'build',
          rationale: 'Nothing works until deploy is green',
          effort: snapshot.deployment.errorCategory === 'config' ? 'small' : 'medium',
          artifact: 'cursor_prompt',
          evidence: shortcoming?.evidence || [],
        };
      }

      if (snapshot.deployment.status === 'none') {
        return {
          action: 'Deploy to Vercel',
          actionType: 'build',
          rationale: 'Need a live URL to test and share',
          effort: 'small',
          artifact: 'none',
          evidence: [],
        };
      }

      // Default build action
      return {
        action: 'Continue building core functionality',
        actionType: 'build',
        rationale: 'Not yet ready for GTM',
        effort: 'medium',
        artifact: 'cursor_prompt',
        evidence: [],
      };
    }

    // GTM actions
    if (!snapshot.gtmChecks.hasReadme || !snapshot.gtmChecks.hasLandingContent) {
      return {
        action: 'Add README with clear description and CTA',
        actionType: 'gtm',
        rationale: 'People need to understand what this is in 5 seconds',
        effort: 'small',
        artifact: 'landing_copy',
        evidence: shortcoming?.evidence || [],
      };
    }

    if (!snapshot.gtmChecks.hasClearCTA) {
      return {
        action: 'Add clear CTA to README/landing',
        actionType: 'gtm',
        rationale: 'Visitors need to know what to do next',
        effort: 'small',
        artifact: 'landing_copy',
        evidence: shortcoming?.evidence || [],
      };
    }

    if (!snapshot.gtmChecks.hasDemoAsset) {
      return {
        action: 'Add demo screenshot or GIF',
        actionType: 'gtm',
        rationale: 'Visual proof of what it does increases conversion',
        effort: 'small',
        artifact: 'none',
        evidence: [],
      };
    }

    // Ready to launch!
    return {
      action: 'Draft and post launch announcement',
      actionType: 'gtm',
      rationale: 'Project is ready to share with your audience',
      effort: 'small',
      artifact: 'launch_post',
      evidence: [],
    };
  }

  private shouldAutoMessage(
    snapshot: ProjectSnapshot,
    shortcoming: Shortcoming | null
  ): { shouldAutoMessage: boolean; reason: string } {
    // Always auto-message on operational blockers with evidence
    if (snapshot.operationalBlocker && snapshot.operationalBlocker.evidence.length > 0) {
      return {
        shouldAutoMessage: true,
        reason: `Operational issue: ${snapshot.operationalBlocker.issue}`,
      };
    }

    // Auto-message when project becomes ready_to_launch
    if (snapshot.gtmStage === 'ready_to_launch') {
      return {
        shouldAutoMessage: true,
        reason: 'Project is ready to launch',
      };
    }

    // Auto-message on new deploy errors
    if (snapshot.deployment.status === 'error') {
      return {
        shouldAutoMessage: true,
        reason: 'Deploy is failing',
      };
    }

    // Don't auto-message for strategic/GTM guidance without high confidence
    return {
      shouldAutoMessage: false,
      reason: 'No urgent operational issue',
    };
  }

  private async generateArtifacts(
    snapshot: ProjectSnapshot,
    nextAction: NextAction,
    userProfile?: UserProfile
  ): Promise<{
    cursorPrompt: string | null;
    launchPost: string | null;
    landingCopy: string | null;
    envChecklist: string | null;
  }> {
    const artifacts = {
      cursorPrompt: null as string | null,
      launchPost: null as string | null,
      landingCopy: null as string | null,
      envChecklist: null as string | null,
    };

    switch (nextAction.artifact) {
      case 'cursor_prompt':
        artifacts.cursorPrompt = await this.generateCursorPrompt(snapshot, nextAction);
        break;
      
      case 'launch_post':
        artifacts.launchPost = await this.generateLaunchPost(snapshot, userProfile);
        break;
      
      case 'landing_copy':
        artifacts.landingCopy = await this.generateLandingCopy(snapshot);
        break;
      
      case 'env_checklist':
        artifacts.envChecklist = this.generateEnvChecklist(snapshot);
        break;
    }

    return artifacts;
  }

  private async generateCursorPrompt(
    snapshot: ProjectSnapshot,
    nextAction: NextAction
  ): Promise<string> {
    // Build context about recent changes
    const recentChanges = snapshot.recentCommits.slice(0, 2)
      .map(c => `- ${c.message} (${c.filesChanged.slice(0, 3).join(', ')})`)
      .join('\n');

    const errorContext = snapshot.deployment.errorLog
      ? `\n\n**Error to fix:**\n\`\`\`\n${snapshot.deployment.errorLog.substring(0, 500)}\n\`\`\``
      : '';

    const todosContext = snapshot.todos.length > 0
      ? `\n\n**Relevant TODOs:**\n${snapshot.todos.slice(0, 3).map(t => `- ${t.file}:${t.line}: ${t.text}`).join('\n')}`
      : '';

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `Generate a Cursor AI prompt for this task. Be specific and actionable.

**Project:** ${snapshot.name} (${snapshot.type})
**Task:** ${nextAction.action}
**Rationale:** ${nextAction.rationale}

**Recent commits:**
${recentChanges || 'No recent commits'}

**Recently changed files:** ${snapshot.recentlyChangedFiles.slice(0, 5).join(', ') || 'Unknown'}
${errorContext}${todosContext}

Generate a prompt that:
1. States the specific goal
2. Lists target files (based on recent changes and error)
3. Includes acceptance criteria
4. Is copy-paste ready

Format as a code block.`
        }],
      });

      const content = response.content[0];
      return content.type === 'text' ? content.text : this.fallbackCursorPrompt(snapshot, nextAction);
    } catch {
      return this.fallbackCursorPrompt(snapshot, nextAction);
    }
  }

  private fallbackCursorPrompt(snapshot: ProjectSnapshot, nextAction: NextAction): string {
    return `\`\`\`
In ${snapshot.name}:

${nextAction.action}

Target files: ${snapshot.recentlyChangedFiles.slice(0, 5).join(', ') || 'Check recent changes'}

Acceptance criteria:
- [ ] ${nextAction.action} is complete
- [ ] No regressions
- [ ] Deploy succeeds
\`\`\``;
  }

  private async generateLaunchPost(
    snapshot: ProjectSnapshot,
    userProfile?: UserProfile
  ): Promise<string> {
    const tone = userProfile?.tonePreference || 'casual';
    const channel = userProfile?.primaryLaunchChannel || 'x';
    const voiceSample = userProfile?.voiceSamples?.[0] || '';

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Write a launch post for ${channel} about this project.

**Project:** ${snapshot.name}
**Description:** ${snapshot.description || 'A new project'}
**Type:** ${snapshot.type}
**Live URL:** ${snapshot.deployment.url || 'Coming soon'}

**Tone:** ${tone}
${voiceSample ? `**Voice sample to match:** "${voiceSample}"` : ''}

Write a short, punchy launch post (under 280 chars for X, can be longer for other platforms).
Include:
- What it does (1 sentence)
- Why it's useful
- CTA (try it / check it out)

Just the post text, no explanation.`
        }],
      });

      const content = response.content[0];
      return content.type === 'text' ? content.text : this.fallbackLaunchPost(snapshot);
    } catch {
      return this.fallbackLaunchPost(snapshot);
    }
  }

  private fallbackLaunchPost(snapshot: ProjectSnapshot): string {
    return `Built ${snapshot.name} - ${snapshot.description || 'a new project'}.

${snapshot.deployment.url ? `Try it: ${snapshot.deployment.url}` : 'Link coming soon.'}

What do you think?`;
  }

  private async generateLandingCopy(snapshot: ProjectSnapshot): Promise<string> {
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Generate landing page copy for this project.

**Project:** ${snapshot.name}
**Description:** ${snapshot.description || 'A new project'}
**Type:** ${snapshot.type}

Generate:
1. Headline (5-8 words)
2. Subheadline (1 sentence)
3. 3 key benefits (not features)
4. CTA button text

Format as markdown sections.`
        }],
      });

      const content = response.content[0];
      return content.type === 'text' ? content.text : this.fallbackLandingCopy(snapshot);
    } catch {
      return this.fallbackLandingCopy(snapshot);
    }
  }

  private fallbackLandingCopy(snapshot: ProjectSnapshot): string {
    return `## ${snapshot.name}

${snapshot.description || 'A powerful new tool'}

### Benefits
- Save time
- Work smarter
- Ship faster

**[Get Started →]**`;
  }

  private generateEnvChecklist(snapshot: ProjectSnapshot): string {
    const envVarsUrl = this.getEnvVarsUrl(snapshot.name);
    
    let checklist = `**Missing env vars for ${snapshot.name}:**\n\n`;
    checklist += '```\n';
    snapshot.missingEnvVars.forEach(v => {
      checklist += `${v}=\n`;
    });
    checklist += '```\n\n';
    checklist += `**Add them here:** [Vercel Settings](${envVarsUrl})\n\n`;
    checklist += 'After adding, click "Redeploy" in Vercel to pick up the new vars.';
    
    return checklist;
  }

  private getEnvVarsUrl(projectName: string): string {
    const teamPath = this.vercelTeamId || '';
    return `https://vercel.com/${teamPath}/${projectName}/settings/environment-variables`;
  }
}

