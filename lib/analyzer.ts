// Repo Analyzer - AI analysis of GitHub repositories
import Anthropic from '@anthropic-ai/sdk';
import { GitHubClient } from './github.js';
import { CoreAnalysis, CoreAnalysisSchema, validateAnalysis, TrackedRepo } from './core-types.js';
import { buildAnalysisPrompt, buildRetryPrompt, buildTweetPrompt } from './prompts.js';
import { AI_MODEL } from './config.js';
import { info, error as logErr } from './logger.js';

export class RepoAnalyzer {
  private anthropic: Anthropic;
  private github: GitHubClient;

  constructor(anthropicKey: string, githubToken: string) {
    this.anthropic = new Anthropic({ apiKey: anthropicKey });
    this.github = new GitHubClient(githubToken);
  }

  async analyzeRepo(owner: string, repo: string): Promise<CoreAnalysis> {
    info('analyzer', 'Starting analysis', { owner, repo });

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

    const response = await this.anthropic.messages.create({
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
    const response = await this.anthropic.messages.create({
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

  async regenerateTweet(repo: TrackedRepo, tone: string): Promise<string> {
    const analysis = repo.analysis;
    if (!analysis) throw new Error('No analysis available');

    const response = await this.anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 100,
      temperature: 0.8,
      messages: [{
        role: 'user',
        content: buildTweetPrompt({
          name: repo.name,
          oneLiner: analysis.one_liner,
          coreValue: analysis.core_value || analysis.what_it_does,
          existingTweet: analysis.tweet_draft || undefined,
          tone,
        }),
      }],
    });

    const text = response.content.find(c => c.type === 'text');
    if (!text || text.type !== 'text') {
      return analysis.tweet_draft || analysis.one_liner;
    }

    const tweet = text.text.trim();
    return tweet.length > 280 ? tweet.substring(0, 277) + '...' : tweet;
  }
}
