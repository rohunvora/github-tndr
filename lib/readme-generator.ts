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
1. Starts with the cover image and live demo link (if any) at the very top
2. Leads with the core value in the first paragraph
3. Makes it immediately clear what this tool does and why someone would use it
4. Is scannable - headers, bullets, code blocks
5. Includes practical setup/usage if applicable

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

## Existing README (for reference - IMPORTANT: preserve any demo URLs, Vercel links, or deployment URLs you find)
{{existing_readme}}

## Package.json (for tech stack reference)
{{package_json}}

## README Structure - CRITICAL FORMAT:

The README MUST start with this exact structure:

\`\`\`
<div align="center">
  <img src="/.github/social-preview.png" alt="{{name}}" width="800" />
  
  <h1>{{title}}</h1>
  <p><strong>{{one_liner}}</strong></p>
  
  {{if_demo_exists}}
  <p>
    <a href="{{demo_url}}"><strong>🚀 Live Demo</strong></a>
  </p>
  {{endif}}
</div>
\`\`\`

Replace the placeholders:
- {{title}} = A clean project name (can be formatted nicely)
- {{one_liner}} = The punchy one-liner description  
- {{demo_url}} = Any Vercel, live URL, or homepage found in the existing README or package.json (if none exists, omit the demo link section)

After the header section:
- Brief paragraph explaining what it does and the core value (2-3 sentences max)
- "Features" or "What it does" with bullet points
- "Getting Started" or "Quick Start" with code
- Keep it concise - aim for 300-800 words total
- No badges, minimal emojis (1-2 max for visual emphasis)

Generate the complete README in markdown format.`;

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
