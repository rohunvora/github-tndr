import { TrackedRepo } from './core-types.js';
import { buildCoverPrompt } from './prompts.js';

// Using Gemini 3 Pro Image (Nano Banana Pro) - reasoning-first multimodal model
const GEMINI_IMAGE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent';

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

export async function generateRepoCover(repo: TrackedRepo, aspectRatio: string = '16:9'): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

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
          aspectRatio: aspectRatio,  // Dynamic: '16:9', '9:16', or '4:3'
          imageSize: '4K',           // Request highest quality
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
