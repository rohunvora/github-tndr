/**
 * GitHub URL Parser
 * 
 * Parses various GitHub URL formats and extracts owner/name
 * 
 * Supported formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/
 * - https://github.com/owner/repo.git
 * - https://github.com/owner/repo/blob/main/...
 * - https://github.com/owner/repo/tree/main/...
 * - github.com/owner/repo
 * - git@github.com:owner/repo.git
 * - owner/repo
 * - repo (searches user's repos)
 */

// Regex patterns for GitHub URLs
const GITHUB_URL_REGEX = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/\s?#]+)/i;
const GITHUB_SSH_REGEX = /^git@github\.com:([^\/]+)\/([^\/\s]+?)(?:\.git)?$/i;
const OWNER_REPO_REGEX = /^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/;

export interface ParsedRepo {
  owner: string;
  name: string;
  isUrl: boolean;
}

/**
 * Parse a GitHub URL or owner/repo string into { owner, name }
 * Returns null if the input doesn't match any known format
 * 
 * @param input - URL, owner/repo, or repo name
 * @returns ParsedRepo with owner, name, and whether it was a URL
 */
export function parseGitHubUrl(input: string): ParsedRepo | null {
  const trimmed = input.trim();
  
  // Remove trailing slashes
  const cleaned = trimmed.replace(/\/+$/, '');
  
  // Try HTTPS URL format
  const httpsMatch = cleaned.match(GITHUB_URL_REGEX);
  if (httpsMatch) {
    return {
      owner: httpsMatch[1],
      name: httpsMatch[2].replace(/\.git$/, ''),
      isUrl: true,
    };
  }
  
  // Try SSH format (git@github.com:owner/repo.git)
  const sshMatch = cleaned.match(GITHUB_SSH_REGEX);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      name: sshMatch[2].replace(/\.git$/, ''),
      isUrl: true,
    };
  }
  
  // Try owner/repo format
  const ownerRepoMatch = cleaned.match(OWNER_REPO_REGEX);
  if (ownerRepoMatch) {
    return {
      owner: ownerRepoMatch[1],
      name: ownerRepoMatch[2].replace(/\.git$/, ''),
      isUrl: false,
    };
  }
  
  return null;
}

/**
 * Check if input looks like a GitHub URL
 */
export function isGitHubUrl(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return trimmed.includes('github.com') || trimmed.startsWith('git@github.com');
}

/**
 * Normalize input to owner/repo format
 * Handles URLs by extracting the owner/repo portion
 * 
 * @param input - URL or repo identifier
 * @returns "owner/repo" string, or original input if not a URL
 */
export function normalizeRepoInput(input: string): string {
  const parsed = parseGitHubUrl(input);
  if (parsed) {
    return `${parsed.owner}/${parsed.name}`;
  }
  // Return as-is (could be just a repo name)
  return input.trim();
}

