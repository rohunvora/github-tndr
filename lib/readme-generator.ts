import Anthropic from '@anthropic-ai/sdk';
import { CoreAnalysis } from './core-types.js';
import { GitHubRepo } from './github.js';

export interface ReadmeContext {
  repo: GitHubRepo;
  analysis: CoreAnalysis;
  existingReadme: string | null;
  packageJson: string | null;
  fileTree: string[];
}

const README_GENERATION_PROMPT = `You are an expert at writing GitHub READMEs that convert visitors into users.

Your task: Generate an optimized README for this repository that:
1. Leads with the core value in the first paragraph (bot reads first 3000 chars)
2. Makes it immediately clear what this tool does and why someone would use it
3. Is scannable - headers, bullets, code blocks
4. Includes practical setup/usage if applicable
5. Is honest about what the project is (don't oversell)

## Repository Info
Name: {{name}}
Description: {{description}}

## Analysis
One-liner: {{one_liner}}
What it does: {{what_it_does}}
Core value: {{core_value}}
Why it's valuable: {{why_core}}

## File Structure
{{file_tree}}

## Existing README (for reference - preserve useful info like URLs, tech stack)
{{existing_readme}}

## Package.json (for tech stack reference)
{{package_json}}

## README Structure Guidelines
- Start with a clear, punchy title and one-liner description
- First paragraph should contain THE core value proposition
- Include a "What it does" or "Features" section with bullet points
- Add "Getting Started" or "Usage" section with code examples if applicable
- Keep it concise - aim for 500-1500 words
- No excessive badges, emojis, or filler content
- If there's a demo URL or deployment, include it prominently

Generate the complete README in markdown format. Start directly with the markdown content (# Title).`;

export class ReadmeGenerator {
  private anthropic: Anthropic;

  constructor(anthropicKey: string) {
    this.anthropic = new Anthropic({ apiKey: anthropicKey });
  }

  async generateReadme(ctx: ReadmeContext): Promise<string> {
    const prompt = README_GENERATION_PROMPT
      .replace('{{name}}', ctx.repo.name)
      .replace('{{description}}', ctx.repo.description || '(No description)')
      .replace('{{one_liner}}', ctx.analysis.one_liner)
      .replace('{{what_it_does}}', ctx.analysis.what_it_does)
      .replace('{{core_value}}', ctx.analysis.core_value || ctx.analysis.one_liner)
      .replace('{{why_core}}', ctx.analysis.why_core || 'N/A')
      .replace('{{file_tree}}', ctx.fileTree.slice(0, 50).join('\n'))
      .replace('{{existing_readme}}', ctx.existingReadme?.substring(0, 2000) || '(No existing README)')
      .replace('{{package_json}}', ctx.packageJson?.substring(0, 1000) || '(No package.json)');

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content.find(c => c.type === 'text');
    if (!text || text.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Clean up any markdown code fences if Claude wrapped the output
    let readme = text.text.trim();
    if (readme.startsWith('```markdown')) {
      readme = readme.replace(/^```markdown\n?/, '').replace(/\n?```$/, '');
    } else if (readme.startsWith('```md')) {
      readme = readme.replace(/^```md\n?/, '').replace(/\n?```$/, '');
    } else if (readme.startsWith('```')) {
      readme = readme.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }

    return readme;
  }
}

export function formatReadmeFilename(repo: GitHubRepo): string {
  return `${repo.name}.md`;
}
