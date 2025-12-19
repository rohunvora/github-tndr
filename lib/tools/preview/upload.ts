/**
 * Preview Upload Module
 * 
 * Handles uploading generated cover images to GitHub and updating READMEs.
 * Uploads the image to .github/social-preview.png and optionally adds
 * a header to the README with the image and one-liner.
 * 
 * @example
 * ```typescript
 * const result = await uploadToGitHub('satoshi', 'my-repo', imageBuffer);
 * // result: { imageUploaded: true, readmeUpdated: true }
 * ```
 */

import { GitHubClient } from '../../core/github.js';
import { stateManager } from '../../core/state.js';
import { info, error as logErr } from '../../core/logger.js';

/** Result of the upload operation */
export interface UploadResult {
  /** Whether the image was successfully uploaded */
  imageUploaded: boolean;
  /** Whether the README was updated with the header */
  readmeUpdated: boolean;
  /** Error message if something failed */
  error?: string;
}

/**
 * Uploads a cover image to GitHub and updates the README
 * 
 * This function:
 * 1. Uploads image to .github/social-preview.png
 * 2. Adds image header to README.md (if not already present)
 * 3. Updates tracked repo with the cover URL
 * 
 * @param owner - GitHub username or organization
 * @param name - Repository name
 * @param imageBuffer - Generated image as Buffer
 * @returns Upload result with status of each operation
 * 
 * @example
 * ```typescript
 * const result = await uploadToGitHub('satoshi', 'my-repo', imageBuffer);
 * if (result.imageUploaded) {
 *   console.log('Image uploaded successfully');
 * }
 * if (result.readmeUpdated) {
 *   console.log('README updated with header');
 * }
 * ```
 */
export async function uploadToGitHub(
  owner: string,
  name: string,
  imageBuffer: Buffer
): Promise<UploadResult> {
  const github = new GitHubClient(process.env.GITHUB_TOKEN!);
  const result: UploadResult = { imageUploaded: false, readmeUpdated: false };

  info('preview.upload', 'Starting upload', { owner, name });

  // 1. Upload image to .github/social-preview.png
  try {
    await github.updateFile(
      owner,
      name,
      '.github/social-preview.png',
      imageBuffer.toString('base64'),
      'Add social preview image'
    );
    result.imageUploaded = true;
    info('preview.upload', 'Image uploaded', { owner, name });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    result.error = `Failed to upload image: ${errorMessage}`;
    logErr('preview.upload', err, { owner, name, step: 'image' });
    // Image upload is critical - return early
    return result;
  }

  // 2. Update README with header (if not already present)
  try {
    const readme = await github.getFileContent(owner, name, 'README.md');
    
    if (readme && !readme.includes('social-preview.png')) {
      // Get one-liner from analysis for the header
      const repo = await stateManager.getTrackedRepo(owner, name);
      const oneLiner = repo?.analysis?.one_liner || '';
      const homepage = repo?.homepage || null;

      const header = buildReadmeHeader(name, oneLiner, homepage);
      const updatedReadme = header + readme;

      await github.updateFile(
        owner,
        name,
        'README.md',
        Buffer.from(updatedReadme).toString('base64'),
        'Add cover image to README'
      );
      result.readmeUpdated = true;
      info('preview.upload', 'README updated', { owner, name });
    } else if (readme?.includes('social-preview.png')) {
      info('preview.upload', 'README already has header, skipping', { owner, name });
    } else {
      info('preview.upload', 'No README found, skipping header', { owner, name });
    }
  } catch (err) {
    // README update is non-critical - log but don't fail
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    info('preview.upload', 'README update failed (non-critical)', { 
      owner, 
      name, 
      error: errorMessage,
    });
  }

  // 3. Update tracked repo with cover URL
  try {
    const repo = await stateManager.getTrackedRepo(owner, name);
    if (repo) {
      repo.cover_image_url = `https://raw.githubusercontent.com/${owner}/${name}/main/.github/social-preview.png`;
      await stateManager.saveTrackedRepo(repo);
      info('preview.upload', 'Tracked repo updated', { owner, name });
    }
  } catch (err) {
    // State update is non-critical
    info('preview.upload', 'State update failed (non-critical)', { owner, name });
  }

  return result;
}

/**
 * Builds the README header HTML with centered image and optional description
 * 
 * @param name - Repository name (used for alt text)
 * @param oneLiner - One-line description (optional)
 * @param homepage - Live demo URL (optional)
 * @returns HTML header string to prepend to README
 */
function buildReadmeHeader(
  name: string, 
  oneLiner: string,
  homepage: string | null
): string {
  const description = oneLiner 
    ? `\n  <p><strong>${escapeHtml(oneLiner)}</strong></p>` 
    : '';
  
  const demoLink = homepage
    ? `\n  <p>\n    <a href="${escapeHtml(homepage)}"><strong>🚀 Live Demo</strong></a>\n  </p>`
    : '';

  return `<div align="center">
  <img src="/.github/social-preview.png" alt="${escapeHtml(name)}" width="800" />${description}${demoLink}
</div>

`;
}

/**
 * Escapes HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generates the GitHub settings URL for setting social preview
 * 
 * @param owner - GitHub username or organization
 * @param name - Repository name
 * @returns URL to the repository settings page
 */
export function getSettingsUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}/settings`;
}

/**
 * Generates the raw URL for the uploaded image
 * 
 * @param owner - GitHub username or organization
 * @param name - Repository name
 * @returns Raw GitHub URL for the image
 */
export function getImageUrl(owner: string, name: string): string {
  return `https://raw.githubusercontent.com/${owner}/${name}/main/.github/social-preview.png`;
}


