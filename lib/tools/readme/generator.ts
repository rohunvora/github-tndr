/**
 * README Generator
 * Generate optimized READMEs using AI
 */

import { getAnthropicClient, MODELS } from '../../core/config.js';
import type { CoreAnalysis } from '../../core/types.js';
import { info } from '../../core/logger.js';

/**
 * Minimal repo info needed for README generation
 * Only name and description are used in the template
 */
export interface ReadmeRepoInfo {
  name: string;
  description: string | null;
}

export interface ReadmeContext {
  repo: ReadmeRepoInfo;
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

/**
 * Generate an optimized README
 */
export async function generateReadme(context: ReadmeContext): Promise<string> {
  info('readme', 'Generating README', { repo: context.repo.name });

  const anthropic = getAnthropicClient();
  const a = context.analysis;

  const prompt = README_GENERATION_PROMPT
    .replace('{{name}}', context.repo.name)
    .replace('{{description}}', context.repo.description || '')
    .replace('{{one_liner}}', a.one_liner)
    .replace('{{what_it_does}}', a.what_it_does)
    .replace('{{core_value}}', a.core_value || a.what_it_does)
    .replace('{{why_core}}', a.why_core || '')
    .replace('{{file_tree}}', context.fileTree.slice(0, 30).join('\n'))
    .replace('{{existing_readme}}', context.existingReadme?.substring(0, 2000) || '(No existing README)')
    .replace('{{package_json}}', context.packageJson?.substring(0, 1000) || '{}');

  const response = await anthropic.messages.create({
    model: MODELS.anthropic.sonnet,
    max_tokens: 2000,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(c => c.type === 'text');
  if (!text || text.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  info('readme', 'README generated', { repo: context.repo.name });
  return text.text;
}

