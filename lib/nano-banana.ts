import { TrackedRepo } from './core-types.js';
import { buildCoverPrompt } from './prompts.js';
import { MODELS } from './config.js';

// Using Gemini 3 Pro Image (Nano Banana Pro) - reasoning-first multimodal model
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

export async function generateRepoCover(repo: TrackedRepo): Promise<Buffer> {
  const apiKey = getGeminiApiKey();
  const { prompt } = buildCoverPrompt(repo);

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
          aspectRatio: '16:9',  // Always landscape for README context
          imageSize: '4K',      // Request highest quality
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

  // Extract base64 image from response
  const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  
  if (!imagePart?.inlineData?.data) {
    throw new Error('No image data in Gemini response');
  }

  return Buffer.from(imagePart.inlineData.data, 'base64');
}

/**
 * Polish a real screenshot into a marketing-ready image
 * Sends the screenshot + context to Gemini to enhance while keeping it accurate
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
}
