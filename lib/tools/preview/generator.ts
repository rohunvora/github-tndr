/**
 * Preview Image Generator
 * Uses Gemini 3 Pro Image to generate cover images
 */

import { MODELS } from '../../core/config.js';
import type { TrackedRepo } from '../../core/types.js';
import { info, error as logErr } from '../../core/logger.js';

const GEMINI_IMAGE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.google.imageGen}:generateContent`;

function getGeminiApiKey(): string {
  const apiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_AI_KEY or GEMINI_API_KEY not configured');
  }
  return apiKey;
}

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

// Visual constitution for image generation
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
 * Generate a cover image for a repo
 */
export async function generateCoverImage(repo: TrackedRepo): Promise<Buffer> {
  const a = repo.analysis;
  if (!a) {
    throw new Error('Cannot generate cover without analysis');
  }

  info('preview', 'Generating cover', { repo: repo.name });

  const apiKey = getGeminiApiKey();

  // Determine mode
  const whatItDoes = a.what_it_does.toLowerCase();
  let mode: 'terminal' | 'dashboard' = 'dashboard';

  if (whatItDoes.includes('cli') || whatItDoes.includes('terminal') || whatItDoes.includes('library') || whatItDoes.includes('api') || whatItDoes.includes('script')) {
    mode = 'terminal';
  }

  const prompt = `
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

  info('preview', 'Cover generated', { repo: repo.name });
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

