import Anthropic from '@anthropic-ai/sdk';
import { GitHubClient } from './github.js';
import { CoreAnalysis, CoreAnalysisSchema, validateAnalysis, TrackedRepo } from './core-types.js';
import { buildAnalysisPrompt, buildRetryPrompt, buildTweetPrompt } from './prompts.js';
import { AI_MODEL } from './config.js';

export type StreamPhase = 'fetching' | 'analyzing' | 'complete';

export interface StreamProgress {
  phase: StreamPhase;
  elapsed: number;
  partial: string;
  // Parsed fields (when available)
  one_liner?: string;
  core_value?: string;
  core_evidence_count?: number;
  verdict?: string;
}

export class RepoAnalyzer {
  private anthropic: Anthropic;
  private github: GitHubClient;

  constructor(anthropicKey: string, githubToken: string) {
    this.anthropic = new Anthropic({ apiKey: anthropicKey });
    this.github = new GitHubClient(githubToken);
  }

  /**
   * Stream analysis with real-time progress updates
   */
  async analyzeRepoStreaming(
    owner: string,
    repo: string,
    onProgress: (progress: StreamProgress) => Promise<void>
  ): Promise<CoreAnalysis> {
    const startTime = Date.now();
    const elapsed = () => Date.now() - startTime;

    // Phase 1: Fetch repo data (parallel)
    await onProgress({ phase: 'fetching', elapsed: elapsed(), partial: '' });
    
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

    // Phase 2: Stream Claude's response
    await onProgress({ phase: 'analyzing', elapsed: elapsed(), partial: '' });

    const stream = this.anthropic.messages.stream({
      model: AI_MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    let fullText = '';
    
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; text?: string };
        if (delta.type === 'text_delta' && delta.text) {
          fullText += delta.text;
          
          // Parse partial JSON to extract completed fields
          const parsed = this.parsePartialJson(fullText);
          
          await onProgress({
            phase: 'analyzing',
            elapsed: elapsed(),
            partial: fullText,
            ...parsed,
          });
        }
      }
    }

    // Phase 3: Parse final result
    await onProgress({ phase: 'complete', elapsed: elapsed(), partial: fullText });

    let json = fullText.trim();
    if (json.startsWith('```')) {
      json = json.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const analysis = CoreAnalysisSchema.parse(JSON.parse(json));
    
    const validation = validateAnalysis(analysis, fileTree);
    if (!validation.valid) {
      console.warn(`Validation warnings for ${owner}/${repo}:`, validation.errors);
    }

    return analysis;
  }

  /**
   * Parse partial JSON to extract completed fields for progress display
   */
  private parsePartialJson(partial: string): Partial<{
    one_liner: string;
    core_value: string;
    core_evidence_count: number;
    verdict: string;
  }> {
    const result: ReturnType<typeof this.parsePartialJson> = {};
    
    // Try to extract one_liner
    const oneLinerMatch = partial.match(/"one_liner"\s*:\s*"([^"]+)"/);
    if (oneLinerMatch) result.one_liner = oneLinerMatch[1];
    
    // Try to extract core_value
    const coreValueMatch = partial.match(/"core_value"\s*:\s*"([^"]+)"/);
    if (coreValueMatch) result.core_value = coreValueMatch[1];
    
    // Count core_evidence entries
    const evidenceMatches = partial.match(/"core_evidence"\s*:\s*\[/);
    if (evidenceMatches) {
      const evidenceSection = partial.slice(partial.indexOf('"core_evidence"'));
      const fileMatches = evidenceSection.match(/"file"\s*:/g);
      if (fileMatches) result.core_evidence_count = fileMatches.length;
    }
    
    // Try to extract verdict
    const verdictMatch = partial.match(/"verdict"\s*:\s*"([^"]+)"/);
    if (verdictMatch) result.verdict = verdictMatch[1];
    
    return result;
  }

  /**
   * Non-streaming analysis (for backwards compatibility)
   */
  async analyzeRepo(owner: string, repo: string): Promise<CoreAnalysis> {
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

    const response = await this.anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(c => c.type === 'text');
    if (!text || text.type !== 'text') throw new Error('No text response from Claude');

    let analysis: CoreAnalysis;
    try {
      let json = text.text.trim();
      if (json.startsWith('```')) json = json.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
      analysis = CoreAnalysisSchema.parse(JSON.parse(json));
    } catch {
      return this.retryAnalysis(text.text);
    }

    const validation = validateAnalysis(analysis, fileTree);
    if (!validation.valid) console.warn(`Validation warnings for ${owner}/${repo}:`, validation.errors);

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
    if (!text || text.type !== 'text') throw new Error('No text response from Claude on retry');

    let json = text.text.trim();
    if (json.startsWith('```')) json = json.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
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
    if (!text || text.type !== 'text') return analysis.tweet_draft || analysis.one_liner;

    const tweet = text.text.trim();
    return tweet.length > 280 ? tweet.substring(0, 277) + '...' : tweet;
  }
}
