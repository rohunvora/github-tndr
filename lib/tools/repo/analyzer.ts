/**
 * Repo Analyzer
 * AI analysis of GitHub repositories
 */

import { getAnthropicClient, AI_MODEL } from '../../core/config.js';
import { GitHubClient } from '../../core/github.js';
import { CoreAnalysis, CoreAnalysisSchema, validateAnalysis } from '../../core/types.js';
import { info, error as logErr } from '../../core/logger.js';
import { buildAnalysisPrompt, buildRetryPrompt } from './prompts.js';

export class RepoAnalyzer {
  private github: GitHubClient;

  constructor(githubToken: string) {
    this.github = new GitHubClient(githubToken);
  }

  async analyzeRepo(owner: string, repo: string): Promise<CoreAnalysis> {
    info('analyzer', 'Starting analysis', { owner, repo });

    const anthropic = getAnthropicClient();

    // Fetch all repo data in parallel
    const [repoInfo, readme, packageJson, fileTree, commitSignals] = await Promise.all([
      this.github.getRepoInfo(owner, repo),
      this.github.getFileContent(owner, repo, 'README.md'),
      this.github.getFileContent(owner, repo, 'package.json'),
      this.github.getRepoTree(owner, repo, 100),
      this.github.getCommitSignals(owner, repo),
    ]);

    const prompt = buildAnalysisPrompt({
      owner, repo,
      description: repoInfo?.description || null,
      readme: readme || '(No README)',
      packageJson: packageJson || '{}',
      fileTree: fileTree.slice(0, 50).join('\n') + (fileTree.length > 50 ? `\n... and ${fileTree.length - 50} more` : ''),
      commitSignals,
    });

    info('analyzer', 'Calling Claude', { owner, repo, model: AI_MODEL });

    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(c => c.type === 'text');
    if (!text || text.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    let analysis: CoreAnalysis;
    try {
      let json = text.text.trim();
      if (json.startsWith('```')) {
        json = json.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
      }
      analysis = CoreAnalysisSchema.parse(JSON.parse(json));
    } catch (err) {
      info('analyzer', 'Retrying due to parse error', { owner, repo });
      analysis = await this.retryAnalysis(text.text);
    }

    const validation = validateAnalysis(analysis, fileTree);
    if (!validation.valid) {
      info('analyzer', 'Validation warnings', { owner, repo, errors: validation.errors });
    }

    info('analyzer', 'Analysis complete', { owner, repo, verdict: analysis.verdict });
    return analysis;
  }

  private async retryAnalysis(previousResponse: string): Promise<CoreAnalysis> {
    const anthropic = getAnthropicClient();
    
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      temperature: 0,
      messages: [{ role: 'user', content: buildRetryPrompt(previousResponse) }],
    });

    const text = response.content.find(c => c.type === 'text');
    if (!text || text.type !== 'text') {
      throw new Error('No text response from Claude on retry');
    }

    let json = text.text.trim();
    if (json.startsWith('```')) {
      json = json.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    return CoreAnalysisSchema.parse(JSON.parse(json));
  }
}

// Singleton helper
let analyzerInstance: RepoAnalyzer | null = null;

export function getRepoAnalyzer(): RepoAnalyzer {
  if (!analyzerInstance) {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      throw new Error('GITHUB_TOKEN not configured');
    }
    analyzerInstance = new RepoAnalyzer(githubToken);
  }
  return analyzerInstance;
}

