#!/usr/bin/env npx tsx
/**
 * Deploy READMEs and cover images to GitHub repos
 * 
 * Usage: npm run deploy-github
 * 
 * What it does:
 * 1. Uploads cover image to .github/social-preview.png
 * 2. Updates README.md with image at top + optimized content
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import 'dotenv/config';

const SUMMARY_PATH = join(process.cwd(), 'output', 'summary.json');
const READMES_DIR = join(process.cwd(), 'output', 'readmes');
const IMAGES_DIR = join(process.cwd(), 'output', 'images');

interface SummaryResult {
  name: string;
  score: number;
  one_liner: string | null;
  core_value: string | null;
  readme_path: string | null;
  image_path: string | null;
  error: string | null;
}

function log(msg: string) {
  console.log(`[deploy] ${msg}`);
}

async function getRepoInfo(owner: string, repo: string, token: string): Promise<{ default_branch: string; sha: string | null }> {
  // Get default branch
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  
  if (!repoRes.ok) {
    throw new Error(`Failed to get repo info: ${repoRes.status}`);
  }
  
  const repoData = await repoRes.json() as { default_branch: string };
  
  // Get current README SHA if it exists
  try {
    const contentRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/README.md`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    
    if (contentRes.ok) {
      const contentData = await contentRes.json() as { sha: string };
      return { default_branch: repoData.default_branch, sha: contentData.sha };
    }
  } catch {
    // README doesn't exist
  }
  
  return { default_branch: repoData.default_branch, sha: null };
}

async function getRepoHomepage(owner: string, repo: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (res.ok) {
      const data = await res.json() as { homepage: string | null };
      return data.homepage || null;
    }
  } catch {}
  return null;
}

function injectImageHeader(readme: string, repoName: string, oneLiner: string | null, homepage: string | null): string {
  // Check if header already exists
  if (readme.includes('/.github/social-preview.png')) {
    return readme;
  }
  
  // Build the header
  const demoLink = homepage ? `\n  <p>\n    <a href="${homepage}"><strong>🚀 Live Demo</strong></a>\n  </p>` : '';
  const description = oneLiner ? `\n  <p><strong>${oneLiner}</strong></p>` : '';
  
  const header = `<div align="center">
  <img src="/.github/social-preview.png" alt="${repoName}" width="800" />${description}${demoLink}
</div>

`;

  // Find the first heading and insert before it, or prepend
  const headingMatch = readme.match(/^(#+ .+)$/m);
  if (headingMatch && headingMatch.index !== undefined) {
    return header + readme;
  }
  
  return header + readme;
}

async function updateReadme(owner: string, repo: string, readmePath: string, result: SummaryResult, token: string): Promise<boolean> {
  try {
    let readmeContent = readFileSync(readmePath, 'utf-8');
    
    // Get homepage/demo URL
    const homepage = await getRepoHomepage(owner, repo, token);
    
    // Inject image header at top
    readmeContent = injectImageHeader(readmeContent, repo, result.one_liner, homepage);
    
    const { sha } = await getRepoInfo(owner, repo, token);
    
    const body: Record<string, unknown> = {
      message: 'docs: update README with cover image and optimized content',
      content: Buffer.from(readmeContent).toString('base64'),
    };
    
    if (sha) {
      body.sha = sha;
    }
    
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/README.md`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    
    if (!res.ok) {
      const error = await res.text();
      log(`  ❌ README update failed: ${res.status} - ${error}`);
      return false;
    }
    
    log(`  ✅ README updated (with cover image header)`);
    return true;
  } catch (e: unknown) {
    log(`  ❌ README error: ${(e as Error).message}`);
    return false;
  }
}

async function uploadSocialPreview(owner: string, repo: string, imagePath: string, token: string): Promise<boolean> {
  try {
    const imageBuffer = readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // GitHub's social preview endpoint requires a multipart form upload
    // We need to use the repository settings API
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('image', blob, `${repo}-cover.png`);
    
    // Note: GitHub's official API doesn't have a direct endpoint for social preview
    // The social preview is typically set via web UI or GraphQL API
    // Let's try the GraphQL approach
    
    const graphqlQuery = {
      query: `
        mutation($repositoryId: ID!, $image: Upload!) {
          updateRepository(input: {
            repositoryId: $repositoryId,
            openGraphImageUrl: $image
          }) {
            repository {
              id
            }
          }
        }
      `,
    };
    
    // First, get the repository ID
    const repoIdRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    
    if (!repoIdRes.ok) {
      log(`  ⚠️ Could not get repo ID for social preview`);
      return false;
    }
    
    // Actually, GitHub doesn't support uploading social preview via API
    // The best we can do is:
    // 1. Add the image to the repo (e.g., .github/social-preview.png)
    // 2. User sets it manually, OR
    // 3. We use the description update to note the image exists
    
    // Let's upload the image to .github/social-preview.png
    const imageUploadRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.github/social-preview.png`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'chore: add social preview image',
        content: base64Image,
      }),
    });
    
    if (imageUploadRes.ok) {
      log(`  ✅ Cover image uploaded to .github/social-preview.png`);
      log(`  💡 Set as social preview at: https://github.com/${owner}/${repo}/settings`);
      return true;
    } else if (imageUploadRes.status === 422) {
      // File already exists, try to update it
      const existingFile = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.github/social-preview.png`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      
      if (existingFile.ok) {
        const existing = await existingFile.json() as { sha: string };
        const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.github/social-preview.png`, {
          method: 'PUT',
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: 'chore: update social preview image',
            content: base64Image,
            sha: existing.sha,
          }),
        });
        
        if (updateRes.ok) {
          log(`  ✅ Cover image updated in .github/social-preview.png`);
          return true;
        }
      }
    }
    
    log(`  ⚠️ Could not upload cover image`);
    return false;
  } catch (e: unknown) {
    log(`  ⚠️ Cover image error: ${(e as Error).message}`);
    return false;
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN not set');
    process.exit(1);
  }
  
  if (!existsSync(SUMMARY_PATH)) {
    console.error('Error: No summary.json found. Run optimize-readmes first.');
    process.exit(1);
  }
  
  // Get GitHub username
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  
  if (!userRes.ok) {
    console.error('Error: Could not get GitHub user info');
    process.exit(1);
  }
  
  const user = await userRes.json() as { login: string };
  const owner = user.login;
  
  log(`Deploying as ${owner}`);
  
  const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf-8'));
  const results: SummaryResult[] = summary.results;
  
  // Filter to repos that have READMEs generated
  const deployable = results.filter(r => r.readme_path && existsSync(r.readme_path));
  
  log(`Found ${deployable.length} repos to deploy`);
  console.log('');
  
  let readmeSuccess = 0;
  let imageSuccess = 0;
  
  for (const result of deployable) {
    log(`📦 ${result.name}`);
    
    // Upload cover image FIRST (so README can reference it)
    if (result.image_path && existsSync(result.image_path)) {
      if (await uploadSocialPreview(owner, result.name, result.image_path, token)) {
        imageSuccess++;
      }
    }
    
    // Update README (with image header injected)
    if (result.readme_path && existsSync(result.readme_path)) {
      if (await updateReadme(owner, result.name, result.readme_path, result, token)) {
        readmeSuccess++;
      }
    }
    
    console.log('');
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('═'.repeat(50));
  log(`✅ ${readmeSuccess}/${deployable.length} READMEs deployed`);
  log(`✅ ${imageSuccess}/${deployable.length} cover images uploaded`);
  console.log('');
  log(`💡 To set social previews, visit each repo's Settings page`);
  log(`   or use: https://github.com/${owner}/<repo>/settings`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
