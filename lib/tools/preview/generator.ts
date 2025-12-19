/**
 * Preview Image Generator
 * 
 * Generates cover images for GitHub repos using Gemini 3 Pro Image.
 * Supports iterative feedback to refine images based on user input.
 * 
 * Features:
 * - Visual Constitution prompt for consistent, high-quality output
 * - Feedback accumulation for iterative refinement
 * - Timeout handling for serverless environments
 * 
 * Note: Screenshot fallback is NOT available in Edge runtime.
 * For screenshot functionality, use a separate Node.js API route.
 * 
 * @example
 * ```typescript
 * // Initial generation
 * const image = await generateCoverImage(repo, []);
 * 
 * // With feedback from user
 * const refinedImage = await generateCoverImage(repo, [
 *   'make it darker',
 *   'show terminal output',
 * ]);
 * ```
 */

import { MODELS } from '../../core/config.js';
import type { TrackedRepo } from '../../core/types.js';
import { info } from '../../core/logger.js';

/** Gemini API endpoint for image generation */
const GEMINI_IMAGE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.google.imageGen}:generateContent`;

/** Timeout for image generation (45 seconds to leave buffer for Vercel's 60s limit) */
const GENERATION_TIMEOUT = 45000;

/**
 * Gets the Gemini API key from environment
 * @throws Error if not configured
 */
function getGeminiApiKey(): string {
  const apiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_AI_KEY or GEMINI_API_KEY not configured');
  }
  return apiKey;
}

/** Gemini API response structure */
interface GeminiImageResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
      }>;
    };
  }>;
  error?: {
    message: string;
    code: number;
  };
}

/**
 * Visual Constitution - Expert-optimized prompt for consistent, high-quality images
 * 
 * This prompt system ensures:
 * - No stock photo aesthetics
 * - No device frames (laptops, phones)
 * - Clean, floating UI style
 * - Consistent 16:9 landscape orientation
 */
const VISUAL_CONSTITUTION = `
ROLE: You are a UI/UX Designer creating a product screenshot for a landing page.
OBJECTIVE: Show the ACTUAL INTERFACE of the product, not a photo of someone using it.

CRITICAL: DO NOT GENERATE:
- Laptops, monitors, or computer screens showing the product
- Stock photo style images with people or hands
- "Marketing shots" or "product photography"
- 3D renders of devices or phone mockups
- Vertical/portrait orientation - ALWAYS use landscape 16:9

WHAT TO GENERATE:
- The UI itself, floating on a clean background
- A direct screenshot-style view of the interface
- Clean, flat design with subtle shadows
- LANDSCAPE orientation (16:9)

THE 2 VISUAL MODES:

1. MODE: "TERMINAL" (CLI, DevTools, Libraries, APIs)
   - Show: A terminal window or code editor pane, floating
   - Background: Dark charcoal or navy, matte
   - Style: Monospace font, syntax highlighting, clean borders
   - NO laptops. Just the terminal window itself.

2. MODE: "DASHBOARD" (SaaS, Web Apps, Analytics, B2B, Consumer Apps)
   - Show: Browser window or UI cards floating, NO laptop around it
   - Background: Off-white, cream, or soft gradient
   - Style: Rounded corners, soft shadows, plenty of whitespace
   - Like Stripe/Linear marketing - just the UI, not a photo of it.

MANDATORY:
1. Show the product WORKING with real-looking data
2. The product name must appear as text in the image
3. NO STOCK PHOTO AESTHETICS - this should look like a UI screenshot, not a photo
4. ALWAYS landscape 16:9 aspect ratio
`;

/**
 * Determines the visual mode based on what the product does
 * 
 * @param whatItDoes - Description of what the product does
 * @returns 'terminal' for CLI/dev tools, 'dashboard' for web apps
 */
function determineMode(whatItDoes: string): 'terminal' | 'dashboard' {
  const lower = whatItDoes.toLowerCase();
  const terminalKeywords = ['cli', 'terminal', 'library', 'api', 'script', 'command', 'npm', 'package'];
  
  for (const keyword of terminalKeywords) {
    if (lower.includes(keyword)) {
      return 'terminal';
    }
  }
  
  return 'dashboard';
}

/**
 * Builds the complete prompt including feedback
 * 
 * @param repo - Repository with analysis data
 * @param feedback - Array of user feedback strings to incorporate
 * @returns Complete prompt string
 */
function buildPrompt(repo: TrackedRepo, feedback: string[]): string {
  const a = repo.analysis!;
  const mode = determineMode(a.what_it_does);

  let prompt = `
${VISUAL_CONSTITUTION}

PRODUCT: "${repo.name}"
WHAT IT DOES: ${a.what_it_does}
CORE VALUE: ${a.core_value}

SELECTED MODE: ${mode.toUpperCase()}

Generate a UI screenshot for "${repo.name}".

${mode === 'terminal' ? `
Show a floating terminal/code editor window on a dark matte background.
Inside the terminal, show realistic output that demonstrates: ${a.core_value}
Example: command prompts, success messages, code snippets.
` : `
Show the web UI floating on an off-white/cream background. NO LAPTOP.
Just the browser window or UI cards with soft shadows.
The interface should display: ${a.core_value}
Style: Clean, minimal, like Stripe or Linear marketing screenshots.
`}

IMPORTANT:
- Include the text "${repo.name}" somewhere visible in the image
- Show realistic data, not placeholder text
- This should look like a REAL PRODUCT SCREENSHOT, not a stock photo
`;

  // Append user feedback if provided
  if (feedback.length > 0) {
    prompt += `\n\n## USER FEEDBACK (incorporate these changes)\n`;
    feedback.forEach((f, i) => {
      prompt += `${i + 1}. ${f}\n`;
    });
    prompt += `\nPrioritize the user's feedback over default styling. Make the requested changes while maintaining quality.`;
  }

  return prompt;
}

/**
 * Generates a cover image for a repository using Gemini
 * 
 * @param repo - Repository with analysis data
 * @param feedback - Array of user feedback strings (empty for first generation)
 * @returns Generated image as Buffer
 * @throws Error if generation fails or times out
 * 
 * @example
 * ```typescript
 * // Initial generation
 * const image = await generateCoverImage(repo, []);
 * 
 * // After user rejects and provides feedback
 * const refined = await generateCoverImage(repo, ['make it darker', 'show CLI output']);
 * ```
 */
export async function generateCoverImage(
  repo: TrackedRepo,
  feedback: string[] = []
): Promise<Buffer> {
  const a = repo.analysis;
  if (!a) {
    throw new Error('Cannot generate cover without analysis');
  }

  info('preview', 'Generating cover', { 
    repo: repo.name, 
    feedbackCount: feedback.length,
    attempt: feedback.length + 1,
  });

  const apiKey = getGeminiApiKey();
  const prompt = buildPrompt(repo, feedback);

  // Setup timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT);

  try {
    const response = await fetch(`${GEMINI_IMAGE_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt,
          }],
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '16:9',
            imageSize: '4K',
          },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as GeminiImageResponse;

    if (data.error) {
      throw new Error(`Gemini error: ${data.error.message}`);
    }

    const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

    if (!imagePart?.inlineData?.data) {
      throw new Error('No image data in Gemini response');
    }

    info('preview', 'Cover generated with Gemini', { repo: repo.name });
    return Buffer.from(imagePart.inlineData.data, 'base64');
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Image generation timed out - try again');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Polishes a real screenshot into a marketing-ready image
 * Sends the screenshot + context to Gemini to enhance while keeping it accurate
 * 
 * Note: This is an advanced feature for when you have a real screenshot
 * but want it polished. Not used in the main preview flow.
 * 
 * @param screenshot - Original screenshot buffer
 * @param context - Product context for the polish prompt
 * @returns Polished image as Buffer
 */
export async function polishScreenshot(
  screenshot: Buffer,
  context: { name: string; oneLiner: string; coreValue: string }
): Promise<Buffer> {
  const apiKey = getGeminiApiKey();

  const prompt = `You are a product designer creating a marketing screenshot.

I'm giving you a REAL screenshot of "${context.name}" - a live product.

YOUR TASK: Create a polished, marketing-ready version of this screenshot.

WHAT THE PRODUCT DOES: ${context.oneLiner}
CORE VALUE: ${context.coreValue}

RULES - CRITICAL:
1. KEEP THE ACTUAL UI - this is a real product, do not invent a different interface
2. Keep the same layout, colors, and content visible in the screenshot
3. Polish it for marketing: clean background, subtle shadows, professional presentation
4. Add the product name "${context.name}" prominently if not already visible
5. Remove any distracting elements (cookie banners, browser chrome, etc.)
6. Output in 16:9 landscape aspect ratio
7. Make it look like a Stripe/Linear marketing screenshot - clean, professional, focused

DO NOT:
- Invent new UI elements not in the original
- Change the fundamental design or layout
- Add fake data that wasn't there
- Make it look like a stock photo
- Add laptop/device frames around it

The goal is: same product, polished presentation.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GENERATION_TIMEOUT);

  try {
    const response = await fetch(`${GEMINI_IMAGE_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: prompt,
            },
            {
              inlineData: {
                mimeType: 'image/png',
                data: screenshot.toString('base64'),
              },
            },
          ],
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '16:9',
            imageSize: '4K',
          },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini polish error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as GeminiImageResponse;

    if (data.error) {
      throw new Error(`Gemini polish error: ${data.error.message}`);
    }

    const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

    if (!imagePart?.inlineData?.data) {
      throw new Error('No image data in Gemini polish response');
    }

    return Buffer.from(imagePart.inlineData.data, 'base64');
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Image polish timed out - try again');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
