import Anthropic from '@anthropic-ai/sdk';
import { GitHubClient } from './github.js';
import {
  CoreAnalysis,
  CoreAnalysisSchema,
  CursorPrompt,
  ShipPackage,
  validateAnalysis,
} from './core-types.js';

// ============ ANALYZER CLASS ============

export class RepoAnalyzer {
  private anthropic: Anthropic;
  private github: GitHubClient;

  constructor(anthropicKey: string, githubToken: string) {
    this.anthropic = new Anthropic({ apiKey: anthropicKey });
    this.github = new GitHubClient(githubToken);
  }

  /**
   * Deep analyze a repository to find its core value
   */
  async analyzeRepo(owner: string, repo: string): Promise<CoreAnalysis> {
    // Fetch all the data we need in parallel
    const [repoInfo, readme, packageJson, fileTree, commitSignals] = await Promise.all([
      this.github.getRepoInfo(owner, repo),
      this.github.getFileContent(owner, repo, 'README.md'),
      this.github.getFileContent(owner, repo, 'package.json'),
      this.github.getRepoTree(owner, repo, 100),
      this.github.getCommitSignals(owner, repo),
    ]);

    // Build the prompt context
    const fileTreeStr = fileTree.slice(0, 50).join('\n');
    const truncatedNote = fileTree.length > 50 ? `\n... and ${fileTree.length - 50} more files` : '';

    const prompt = this.buildAnalysisPrompt({
      owner,
      repo,
      description: repoInfo?.description || null,
      readme: readme || '(No README)',
      packageJson: packageJson || '{}',
      fileTree: fileTreeStr + truncatedNote,
      commitSignals,
    });

    // Call Claude
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0, // Low temperature for consistent JSON
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract text response
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON from response
    let analysis: CoreAnalysis;
    try {
      // Try to extract JSON from the response (handle markdown code blocks)
      let jsonStr = textContent.text.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
      }
      
      const parsed = JSON.parse(jsonStr);
      analysis = CoreAnalysisSchema.parse(parsed);
    } catch (parseError) {
      console.error('Failed to parse analysis JSON:', parseError);
      console.error('Raw response:', textContent.text);
      
      // Retry with stricter prompt
      return this.retryAnalysis(owner, repo, textContent.text);
    }

    // Validate the analysis
    const validation = validateAnalysis(analysis, fileTree);
    if (!validation.valid) {
      console.warn(`Analysis validation warnings for ${owner}/${repo}:`, validation.errors);
      // Don't fail, just warn - the analysis might still be useful
    }

    return analysis;
  }

  /**
   * Retry analysis with stricter prompt if first attempt failed
   */
  private async retryAnalysis(owner: string, repo: string, previousResponse: string): Promise<CoreAnalysis> {
    const retryPrompt = `Your previous response was not valid JSON. Please try again.

Previous response that failed to parse:
${previousResponse.substring(0, 500)}

Return ONLY a valid JSON object with these exact fields:
{
  "one_liner": "string (max 140 chars)",
  "what_it_does": "string",
  "has_core": boolean,
  "core_value": "string or null",
  "why_core": "string or null",
  "keep": ["array", "of", "file", "paths"],
  "cut": ["array", "of", "file", "paths"],
  "verdict": "ship" | "cut_to_core" | "no_core" | "dead",
  "verdict_reason": "string",
  "tweet_draft": "string (max 280 chars) or null"
}

No markdown, no explanation, just the JSON object.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0,
      messages: [{ role: 'user', content: retryPrompt }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude on retry');
    }

    let jsonStr = textContent.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    return CoreAnalysisSchema.parse(parsed);
  }

  /**
   * Build the analysis prompt
   */
  private buildAnalysisPrompt(context: {
    owner: string;
    repo: string;
    description: string | null;
    readme: string;
    packageJson: string;
    fileTree: string;
    commitSignals: {
      velocity: 'active' | 'stale';
      coherence: 'focused' | 'chaotic';
      days_since_last: number;
      recent_messages: string[];
    };
  }): string {
    return `You are a sharp, no-BS repo analyst. Your job is to find the core valuable thing in this repository (if any) and give an honest verdict.

## Repository: ${context.owner}/${context.repo}
${context.description ? `Description: ${context.description}` : ''}

## README
\`\`\`
${context.readme.substring(0, 3000)}
\`\`\`

## package.json
\`\`\`json
${context.packageJson.substring(0, 1500)}
\`\`\`

## File Structure
\`\`\`
${context.fileTree}
\`\`\`

## Commit Signals
- Activity: ${context.commitSignals.velocity} (${context.commitSignals.days_since_last} days since last commit)
- Commit style: ${context.commitSignals.coherence}
- Recent commits: ${context.commitSignals.recent_messages.slice(0, 3).join(', ') || 'none'}

## Your Task

Analyze this repo and return a JSON object with your assessment.

**Rules:**
1. "Core" means the ONE thing that is novel or valuable. Everything else is bloat.
2. If this is multiple products jammed into one, call it out. Recommend cutting to the core.
3. If there's no clear value, be honest. Verdict should be "no_core" or "dead".
4. If chaotic commits + stale activity, likely "lost focus" → cut_to_core or dead.
5. If focused commits + active, likely intentional complexity → ship or keep building.
6. The "keep" and "cut" lists must be DISJOINT (no file in both).
7. Only list files that appear in the file structure above. Do not invent paths.
8. tweet_draft must be under 280 characters, no hashtags.

**Verdict meanings:**
- "ship": Ready to launch today. Clear value, focused, works.
- "cut_to_core": Has a valuable core buried under bloat. Cut the extras.
- "no_core": Analyzed but no clear value found. Needs clarity or pivot.
- "dead": Abandoned, no value, kill it.

Return ONLY valid JSON (no markdown, no explanation):

{
  "one_liner": "One sentence, max 140 chars",
  "what_it_does": "2-3 sentences explaining what this does",
  "has_core": true or false,
  "core_value": "The one valuable thing (or null)",
  "why_core": "Why this is the core (or null)",
  "keep": ["files/to/keep"],
  "cut": ["files/to/cut"],
  "verdict": "ship" | "cut_to_core" | "no_core" | "dead",
  "verdict_reason": "Why this verdict",
  "tweet_draft": "Draft tweet if ship-ready, else null"
}`;
  }

  /**
   * Generate a Cursor prompt for "cut to core" action
   */
  generateCursorPrompt(
    owner: string,
    repo: string,
    analysis: CoreAnalysis
  ): CursorPrompt {
    const deleteFiles = analysis.cut.join('\n- ');
    const keepFiles = analysis.keep.join(', ');

    return {
      repo: `${owner}/${repo}`,
      goal: `Refactor ${repo} to ONLY focus on: ${analysis.core_value}`,
      delete_files: analysis.cut,
      modify_instructions: `Remove all imports and references to the deleted files from the codebase.
Keep these files: ${keepFiles}
The app should work with only the core functionality.`,
      acceptance: `App loads successfully with only ${analysis.core_value}. No console errors. Deploy succeeds.`,
    };
  }

  /**
   * Format Cursor prompt as copyable text
   */
  formatCursorPrompt(prompt: CursorPrompt): string {
    return `┌─────────────────────────────────────────────────┐
│ Refactor ${prompt.repo} to its core                
│                                                 
│ Goal: ${prompt.goal.substring(0, 45)}...
│                                                 
│ Delete:                                         
${prompt.delete_files.slice(0, 8).map(f => `│ - ${f}`).join('\n')}
${prompt.delete_files.length > 8 ? `│ ... and ${prompt.delete_files.length - 8} more` : ''}
│                                                 
│ ${prompt.modify_instructions.substring(0, 100)}...
│                                                 
│ Acceptance: ${prompt.acceptance.substring(0, 40)}...
└─────────────────────────────────────────────────┘`;
  }

  /**
   * Generate a ship package (tweet + screenshot URL)
   */
  async generateShipPackage(
    owner: string,
    repo: string,
    analysis: CoreAnalysis,
    deployUrl?: string
  ): Promise<ShipPackage> {
    // If we have a tweet draft from analysis, use it
    let tweet = analysis.tweet_draft;

    // If no tweet or need to regenerate
    if (!tweet) {
      tweet = await this.generateTweet(owner, repo, analysis, deployUrl);
    }

    // Get screenshot if we have a deploy URL
    let screenshotUrl: string | null = null;
    if (deployUrl) {
      screenshotUrl = await this.captureScreenshot(deployUrl);
    }

    return {
      repo: `${owner}/${repo}`,
      deploy_url: deployUrl || null,
      screenshot_url: screenshotUrl,
      one_liner: analysis.one_liner,
      tweet,
    };
  }

  /**
   * Generate a tweet for the project
   */
  private async generateTweet(
    owner: string,
    repo: string,
    analysis: CoreAnalysis,
    deployUrl?: string
  ): Promise<string> {
    const prompt = `Write a short, punchy tweet to launch this project. Max 280 characters.

Project: ${repo}
What it does: ${analysis.one_liner}
Core value: ${analysis.core_value || analysis.what_it_does}
${deployUrl ? `URL: ${deployUrl}` : ''}

Rules:
- Under 280 characters total
- No hashtags
- No emojis (optional, one max)
- Include the URL if provided
- Sound like a real person, not marketing speak
- Focus on what it does, not how it was built

Just the tweet text, nothing else.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      temperature: 0.7, // Slightly more creative for tweets
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return `${analysis.one_liner}\n\n${deployUrl || repo}`;
    }

    let tweet = textContent.text.trim();
    
    // Ensure under 280 chars
    if (tweet.length > 280) {
      tweet = tweet.substring(0, 277) + '...';
    }

    return tweet;
  }

  /**
   * Capture screenshot of a URL using microlink
   */
  private async captureScreenshot(url: string): Promise<string | null> {
    try {
      const screenshotApiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false`;
      
      const response = await fetch(screenshotApiUrl, {
        signal: AbortSignal.timeout(15000), // 15s timeout
      });

      if (!response.ok) {
        console.error('Screenshot API error:', response.status);
        return null;
      }

      const data = await response.json() as {
        status: string;
        data?: { screenshot?: { url?: string } };
      };

      if (data.status === 'success' && data.data?.screenshot?.url) {
        return data.data.screenshot.url;
      }

      return null;
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      return null;
    }
  }
}
