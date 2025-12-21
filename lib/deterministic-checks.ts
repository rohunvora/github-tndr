import { TrackedRepo, ProjectStage, DeployState, PackagingChecks } from './core/types.js';

/**
 * Compute project stage based on deterministic checks
 * This is CODE, not LLM - ensures consistent state decisions
 */
export function computeProjectStage(repo: TrackedRepo): ProjectStage {
  // Already shipped
  if (repo.shipped_at) return 'post_launch';
  
  // Check if we have analysis
  if (!repo.analysis) return 'building';
  
  // Dead repos are still "building" (could be revived)
  if (repo.state === 'dead') return 'building';
  
  // Check packaging completeness
  const checks = computePackagingChecks(repo);
  const hasCore = checks.has_clear_cta && checks.has_demo_asset;
  
  // Ready to launch: has core packaging and verdict is ship
  if (hasCore && repo.analysis.verdict === 'ship') {
    return 'ready_to_launch';
  }
  
  // Packaging: has some analysis, working on polish
  if (repo.analysis.has_core) {
    return 'packaging';
  }
  
  return 'building';
}

/**
 * Get deploy state from repo
 * In a full implementation, this would check Vercel API
 * For now, we infer from repo state
 */
export function getDeployState(repo: TrackedRepo): DeployState {
  // TODO: Integrate with Vercel API for real deploy status
  // For now, assume green if repo has analysis and is not dead
  
  if (repo.state === 'dead') {
    return { status: 'unknown' };
  }
  
  if (repo.analysis?.verdict === 'ship' || repo.state === 'ready') {
    return { 
      status: 'green',
      url: `https://${repo.name}.vercel.app`, // Assumed URL pattern
    };
  }
  
  return { status: 'unknown' };
}

/**
 * Parse README for TODO items
 * Looks for common TODO patterns
 */
export function parseReadmeTodos(readme: string | null): string[] {
  if (!readme) return [];
  
  const todos: string[] = [];
  const lines = readme.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Markdown checkboxes: - [ ] item
    const checkboxMatch = line.match(/^[\s]*[-*]\s*\[\s*\]\s*(.+)$/);
    if (checkboxMatch) {
      todos.push(checkboxMatch[1].trim());
      continue;
    }
    
    // TODO: comments
    const todoMatch = line.match(/TODO:?\s*(.+)/i);
    if (todoMatch) {
      todos.push(todoMatch[1].trim());
      continue;
    }
    
    // ## TODO or ### Next Steps sections
    if (/^#{1,3}\s*(TODO|Next Steps?|Roadmap)/i.test(line)) {
      // Grab the next few lines as todos
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const nextLine = lines[j].trim();
        if (nextLine.startsWith('#')) break; // New section
        if (nextLine.startsWith('-') || nextLine.startsWith('*')) {
          const item = nextLine.replace(/^[-*]\s*/, '').replace(/^\[\s*\]\s*/, '');
          if (item.length > 3 && item.length < 200) {
            todos.push(item);
          }
        }
      }
    }
  }
  
  // Dedupe and limit
  return [...new Set(todos)].slice(0, 5);
}

/**
 * Compute packaging checks for a repo
 * These determine if the repo is "launch ready"
 */
export function computePackagingChecks(repo: TrackedRepo): PackagingChecks {
  const analysis = repo.analysis;
  
  // No analysis = nothing checked
  if (!analysis) {
    return {
      has_clear_cta: false,
      has_demo_asset: false,
      has_readme_image: false,
    };
  }
  
  // Check for CTA indicators in analysis
  const hasCta = Boolean(
    analysis.tweet_draft || // Has tweet = has message
    (analysis.core_value && analysis.core_value.length > 20) // Has clear value prop
  );
  
  // Check for demo asset (cover image)
  const hasDemo = Boolean(repo.cover_image_url);
  
  // Check for README image
  // In a full implementation, we'd parse the README for image tags
  const hasReadmeImage = Boolean(repo.cover_image_url);
  
  return {
    has_clear_cta: hasCta,
    has_demo_asset: hasDemo,
    has_readme_image: hasReadmeImage,
  };
}

/**
 * Calculate days since a date
 */
export function getDaysSince(dateString: string | null): number {
  if (!dateString) return 999;
  const date = new Date(dateString);
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Check if today is a new day (for feed reset)
 */
export function isNewDay(lastReset: string | null): boolean {
  if (!lastReset) return true;
  const last = new Date(lastReset);
  const now = new Date();
  return last.toDateString() !== now.toDateString();
}
