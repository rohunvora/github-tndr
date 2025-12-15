import { GitHubClient } from './github.js';
import { VercelClient, VercelProject } from './vercel.js';
import { 
  EvidenceRef, 
  GTMStage, 
  GTMReadinessChecks, 
  TodoSignal,
  Shortcoming,
  NextAction,
  computeNotificationKey,
} from './types.js';

// ============ COMMIT INFO ============

export interface CommitInfo {
  sha: string;
  message: string;
  date: string;
  filesChanged: string[];
  additions: number;
  deletions: number;
}

// ============ ENHANCED PROJECT SNAPSHOT ============

export interface ProjectSnapshot {
  // Identity
  name: string;
  repo: string;
  description: string | null;
  type: 'nextjs-app' | 'react-app' | 'node-service' | 'cli' | 'library' | 'static-site' | 'unknown';
  
  // Recent activity
  recentCommits: CommitInfo[];
  lastActivity: string | null;
  recentlyChangedFiles: string[];  // Files touched in last 5 commits
  
  // Code signals
  keyFiles: {
    readme: string | null;
    envExample: string | null;
    packageJson: Record<string, unknown> | null;
    vercelJson: Record<string, unknown> | null;
  };
  envVarsReferenced: string[];
  todos: TodoSignal[];  // Filtered to relevant only
  
  // Deploy state (Vercel)
  vercelProjectId: string | null;
  deploymentId: string | null;  // For dedupe
  deployment: {
    status: 'ready' | 'error' | 'building' | 'queued' | 'none';
    url: string | null;
    errorLog: string | null;
    errorCategory: 'auth' | 'config' | 'runtime' | 'build' | 'unknown' | null;
    envVarsConfigured: string[];
    lastDeployedAt: string | null;
  };
  
  // GTM State (deterministic)
  gtmStage: GTMStage;
  gtmChecks: GTMReadinessChecks;
  
  // Screenshot
  screenshot: {
    url: string | null;
    capturedAt: string | null;
    error: string | null;
  };
  
  // Computed blockers with evidence
  missingEnvVars: string[];
  operationalBlocker: Shortcoming | null;  // Deploy error, missing env, etc.
  gtmBlocker: Shortcoming | null;          // Missing CTA, no demo, etc.
  
  // For dedupe
  notificationKey: string;
  
  // Timestamps
  snapshotAt: string;
}

// ============ COLLECTOR ============

export class Collector {
  private github: GitHubClient;
  private vercel: VercelClient;
  private vercelTeamId: string | null;

  constructor(githubToken: string, vercelToken: string, vercelTeamId?: string) {
    this.github = new GitHubClient(githubToken);
    this.vercel = new VercelClient(vercelToken, vercelTeamId);
    this.vercelTeamId = vercelTeamId || null;
  }

  async collectSnapshot(repoFullName: string): Promise<ProjectSnapshot> {
    const [owner, repo] = repoFullName.split('/');
    const snapshotAt = new Date().toISOString();

    // Parallel fetch: commits, key files, vercel projects
    const [commits, keyFiles, vercelProjects] = await Promise.all([
      this.getRecentCommits(owner, repo),
      this.getKeyFiles(owner, repo),
      this.vercel.getProjects().catch(() => []),
    ]);

    // Find matching Vercel project
    const vercelProject = vercelProjects.find(
      p => p.name === repo || p.link?.repo?.includes(repo)
    );

    // Get deployment info if Vercel project exists
    const deploymentInfo = vercelProject
      ? await this.getDeploymentInfo(vercelProject)
      : {
          deploymentId: null,
          status: 'none' as const,
          url: null,
          errorLog: null,
          errorCategory: null,
          envVarsConfigured: [],
          lastDeployedAt: null,
        };

    // Parse package.json
    const packageJson = keyFiles.packageJson
      ? this.safeJsonParse(keyFiles.packageJson)
      : null;

    // Detect project type
    const projectType = this.detectProjectType(keyFiles, packageJson);

    // Extract env vars referenced in code
    const envVarsReferenced = this.extractEnvVars(keyFiles);

    // Find missing env vars
    const missingEnvVars = envVarsReferenced.filter(
      v => !deploymentInfo.envVarsConfigured.includes(v)
    );

    // Get recently changed files (for TODO filtering)
    const recentlyChangedFiles = this.getRecentlyChangedFiles(commits);

    // Extract filtered TODOs (only from recent/critical files)
    const todos = await this.extractFilteredTodos(owner, repo, recentlyChangedFiles);

    // Capture screenshot if deploy is ready
    const screenshot = deploymentInfo.url
      ? await this.captureScreenshot(deploymentInfo.url)
      : { url: null, capturedAt: null, error: null };

    // Run GTM readiness checks (deterministic)
    const gtmChecks = this.runGTMChecks({
      deployStatus: deploymentInfo.status,
      deployUrl: deploymentInfo.url,
      readme: keyFiles.readme,
      description: null, // Will be filled later
      screenshot,
      packageJson,
    });

    // Determine GTM stage
    const gtmStage = this.determineGTMStage(deploymentInfo.status, gtmChecks, missingEnvVars);

    // Compute operational blocker with evidence
    const operationalBlocker = this.computeOperationalBlocker({
      deploymentId: deploymentInfo.deploymentId,
      deployStatus: deploymentInfo.status,
      errorLog: deploymentInfo.errorLog,
      errorCategory: deploymentInfo.errorCategory,
      missingEnvVars,
      envVarsConfigured: deploymentInfo.envVarsConfigured,
    });

    // Compute GTM blocker with evidence
    const gtmBlocker = this.computeGTMBlocker(gtmChecks, gtmStage);

    // Compute notification key for dedupe
    const notificationKey = computeNotificationKey({
      deploymentId: deploymentInfo.deploymentId,
      latestCommitSha: commits[0]?.sha || null,
      deployStatus: deploymentInfo.status,
      missingEnvVars,
      gtmStage,
    });

    return {
      name: repo,
      repo: repoFullName,
      description: null,
      type: projectType,
      recentCommits: commits,
      lastActivity: commits[0]?.date || null,
      recentlyChangedFiles,
      keyFiles: {
        readme: keyFiles.readme,
        envExample: keyFiles.envExample,
        packageJson,
        vercelJson: keyFiles.vercelJson ? this.safeJsonParse(keyFiles.vercelJson) : null,
      },
      envVarsReferenced,
      todos,
      vercelProjectId: vercelProject?.id || null,
      deploymentId: deploymentInfo.deploymentId,
      deployment: {
        status: deploymentInfo.status,
        url: deploymentInfo.url,
        errorLog: deploymentInfo.errorLog,
        errorCategory: deploymentInfo.errorCategory,
        envVarsConfigured: deploymentInfo.envVarsConfigured,
        lastDeployedAt: deploymentInfo.lastDeployedAt,
      },
      gtmStage,
      gtmChecks,
      screenshot,
      missingEnvVars,
      operationalBlocker,
      gtmBlocker,
      notificationKey,
      snapshotAt,
    };
  }

  async collectTopProjects(limit: number = 10): Promise<ProjectSnapshot[]> {
    const repos = await this.github.getUserRepos();
    
    // Filter to recently active repos (last 7 days)
    const recentRepos = repos
      .filter(r => {
        const daysSince = (Date.now() - new Date(r.pushed_at).getTime()) / (1000 * 60 * 60 * 24);
        return daysSince <= 7;
      })
      .slice(0, limit);

    // Collect snapshots in parallel
    const snapshots = await Promise.all(
      recentRepos.map(async (repo) => {
        try {
          const snapshot = await this.collectSnapshot(repo.full_name);
          snapshot.description = repo.description;
          // Re-run GTM checks with description
          snapshot.gtmChecks = this.runGTMChecks({
            deployStatus: snapshot.deployment.status,
            deployUrl: snapshot.deployment.url,
            readme: snapshot.keyFiles.readme,
            description: repo.description,
            screenshot: snapshot.screenshot,
            packageJson: snapshot.keyFiles.packageJson,
          });
          return snapshot;
        } catch (error) {
          console.error(`Failed to collect snapshot for ${repo.full_name}:`, error);
          return null;
        }
      })
    );

    return snapshots.filter((s): s is ProjectSnapshot => s !== null);
  }

  // ============ PRIVATE METHODS ============

  private async getRecentCommits(owner: string, repo: string): Promise<CommitInfo[]> {
    try {
      const commits = await this.github.getRepoCommits(owner, repo);
      
      const detailedCommits = await Promise.all(
        commits.slice(0, 5).map(async (c) => {
          try {
            const detailed = await this.github.getCommitWithDiff(owner, repo, c.sha);
            return {
              sha: c.sha.substring(0, 7),
              message: c.commit.message.split('\n')[0].substring(0, 100),
              date: c.commit.author.date,
              filesChanged: detailed.files?.map(f => f.filename) || [],
              additions: detailed.files?.reduce((sum, f) => sum + f.additions, 0) || 0,
              deletions: detailed.files?.reduce((sum, f) => sum + f.deletions, 0) || 0,
            };
          } catch {
            return {
              sha: c.sha.substring(0, 7),
              message: c.commit.message.split('\n')[0].substring(0, 100),
              date: c.commit.author.date,
              filesChanged: [],
              additions: 0,
              deletions: 0,
            };
          }
        })
      );

      return detailedCommits;
    } catch {
      return [];
    }
  }

  private async getKeyFiles(owner: string, repo: string): Promise<{
    readme: string | null;
    envExample: string | null;
    packageJson: string | null;
    vercelJson: string | null;
  }> {
    const files = await this.github.getMultipleFiles(owner, repo, [
      'README.md',
      'readme.md',
      '.env.example',
      '.env.local.example',
      'package.json',
      'vercel.json',
    ]);

    return {
      readme: files['README.md'] || files['readme.md'] || null,
      envExample: files['.env.example'] || files['.env.local.example'] || null,
      packageJson: files['package.json'] || null,
      vercelJson: files['vercel.json'] || null,
    };
  }

  private async getDeploymentInfo(project: VercelProject): Promise<{
    deploymentId: string | null;
    status: 'ready' | 'error' | 'building' | 'queued' | 'none';
    url: string | null;
    errorLog: string | null;
    errorCategory: 'auth' | 'config' | 'runtime' | 'build' | 'unknown' | null;
    envVarsConfigured: string[];
    lastDeployedAt: string | null;
  }> {
    try {
      const [deployment, envVars] = await Promise.all([
        this.vercel.getLatestDeployment(project.id, 'production'),
        this.vercel.getConfiguredEnvKeys(project.id, 'production'),
      ]);

      if (!deployment) {
        return {
          deploymentId: null,
          status: 'none',
          url: null,
          errorLog: null,
          errorCategory: null,
          envVarsConfigured: envVars,
          lastDeployedAt: null,
        };
      }

      let errorLog: string | null = null;
      let errorCategory: 'auth' | 'config' | 'runtime' | 'build' | 'unknown' | null = null;

      if (deployment.state === 'ERROR') {
        errorLog = await this.vercel.getDeploymentLogs(deployment.uid);
        if (deployment.error?.message) {
          errorLog = `${deployment.error.message}\n\n${errorLog}`;
        }
        errorCategory = this.categorizeError(errorLog);
      }

      const statusMap: Record<string, 'ready' | 'error' | 'building' | 'queued'> = {
        'READY': 'ready',
        'ERROR': 'error',
        'BUILDING': 'building',
        'QUEUED': 'queued',
        'CANCELED': 'error',
      };

      return {
        deploymentId: deployment.uid,
        status: statusMap[deployment.state] || 'none',
        url: deployment.state === 'READY' ? `https://${deployment.url}` : null,
        errorLog,
        errorCategory,
        envVarsConfigured: envVars,
        lastDeployedAt: deployment.readyAt
          ? new Date(deployment.readyAt).toISOString()
          : null,
      };
    } catch {
      return {
        deploymentId: null,
        status: 'none',
        url: null,
        errorLog: null,
        errorCategory: null,
        envVarsConfigured: [],
        lastDeployedAt: null,
      };
    }
  }

  private categorizeError(errorLog: string | null): 'auth' | 'config' | 'runtime' | 'build' | 'unknown' {
    if (!errorLog) return 'unknown';
    const log = errorLog.toLowerCase();
    
    if (log.includes('unauthorized') || log.includes('forbidden') || log.includes('api key') || log.includes('token')) {
      return 'auth';
    }
    if (log.includes('env') || log.includes('config') || log.includes('missing') || log.includes('not found')) {
      return 'config';
    }
    if (log.includes('runtime') || log.includes('500') || log.includes('crash')) {
      return 'runtime';
    }
    if (log.includes('build') || log.includes('compile') || log.includes('module') || log.includes('import')) {
      return 'build';
    }
    return 'unknown';
  }

  private async captureScreenshot(url: string): Promise<{
    url: string | null;
    capturedAt: string | null;
    error: string | null;
  }> {
    // Security: only screenshot public URLs, no auth
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      return { url: null, capturedAt: null, error: 'localhost not allowed' };
    }

    try {
      // Use microlink for screenshots (free tier, no API key needed)
      const screenshotApiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url`;
      
      const response = await fetch(screenshotApiUrl, { 
        signal: AbortSignal.timeout(10000) // 10s timeout
      });
      
      if (!response.ok) {
        return { url: null, capturedAt: null, error: `Screenshot API error: ${response.status}` };
      }
      
      const data = await response.json() as { status: string; data?: { screenshot?: { url?: string } } };
      
      if (data.status === 'success' && data.data?.screenshot?.url) {
        return {
          url: data.data.screenshot.url,
          capturedAt: new Date().toISOString(),
          error: null,
        };
      }
      
      return { url: null, capturedAt: null, error: 'No screenshot in response' };
    } catch (error) {
      return { url: null, capturedAt: null, error: String(error) };
    }
  }

  private getRecentlyChangedFiles(commits: CommitInfo[]): string[] {
    const files = new Set<string>();
    commits.forEach(c => c.filesChanged.forEach(f => files.add(f)));
    return Array.from(files);
  }

  private async extractFilteredTodos(
    owner: string, 
    repo: string, 
    recentlyChangedFiles: string[]
  ): Promise<TodoSignal[]> {
    const todos: TodoSignal[] = [];
    
    // Only look in recently changed files and critical paths
    const criticalPaths = ['api/', 'lib/', 'app/', 'src/', 'pages/'];
    const filesToCheck = recentlyChangedFiles.filter(f => 
      criticalPaths.some(p => f.startsWith(p)) || f.endsWith('.ts') || f.endsWith('.tsx')
    ).slice(0, 10); // Limit to 10 files

    for (const file of filesToCheck) {
      try {
        const content = await this.github.getFileContent(owner, repo, file);
        if (!content) continue;

        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          const todoMatch = line.match(/\/\/\s*(TODO|FIXME|HACK|XXX):?\s*(.+)/i);
          if (todoMatch) {
            todos.push({
              file,
              line: idx + 1,
              text: todoMatch[2].trim().substring(0, 100),
              relevance: 'recent_change',
            });
          }
        });
      } catch {
        // Skip files we can't read
      }
    }

    return todos.slice(0, 10); // Cap at 10 TODOs
  }

  private runGTMChecks(context: {
    deployStatus: string;
    deployUrl: string | null;
    readme: string | null;
    description: string | null;
    screenshot: { url: string | null; capturedAt: string | null; error: string | null };
    packageJson: Record<string, unknown> | null;
  }): GTMReadinessChecks {
    const evidence: EvidenceRef[] = [];

    // Deploy green
    const deployGreen = context.deployStatus === 'ready';
    if (!deployGreen && context.deployStatus !== 'none') {
      evidence.push({ kind: 'http_check', url: context.deployUrl || 'unknown', status: 500, error: context.deployStatus });
    }

    // URL loads (we have a screenshot = it loaded)
    const urlLoads = !!context.screenshot.url;
    if (context.screenshot.error) {
      evidence.push({ kind: 'http_check', url: context.deployUrl || 'unknown', status: 0, error: context.screenshot.error });
    }

    // Has clear CTA (check README for action words)
    const ctaPatterns = /try it|get started|sign up|install|demo|live|check it out/i;
    const hasClearCTA = !!(context.readme && ctaPatterns.test(context.readme));

    // Mobile usable - we'd need a mobile screenshot for this, assume true if desktop works
    const mobileUsable = urlLoads;

    // Has landing content
    const hasLandingContent = !!(context.readme && context.readme.length > 200);

    // Has README
    const hasReadme = !!context.readme;
    if (!hasReadme) {
      evidence.push({ kind: 'file_missing', path: 'README.md', expected: 'Project documentation' });
    }

    // Has description
    const hasDescription = !!context.description || !!(context.packageJson?.description);

    // Has demo asset (screenshot exists)
    const hasDemoAsset = !!context.screenshot.url;
    if (context.screenshot.url) {
      evidence.push({ kind: 'screenshot', url: context.screenshot.url, capturedAt: context.screenshot.capturedAt || new Date().toISOString() });
    }

    return {
      deployGreen,
      urlLoads,
      hasClearCTA,
      mobileUsable,
      hasLandingContent,
      hasReadme,
      hasDescription,
      hasDemoAsset,
      evidence,
    };
  }

  private determineGTMStage(
    deployStatus: string,
    gtmChecks: GTMReadinessChecks,
    missingEnvVars: string[]
  ): GTMStage {
    // Building: deploy not ready or critical env vars missing
    if (deployStatus === 'error' || deployStatus === 'building' || deployStatus === 'none') {
      return 'building';
    }
    
    const criticalEnvVars = missingEnvVars.filter(v => 
      v.includes('API_KEY') || v.includes('SECRET') || v.includes('TOKEN') || v.includes('DATABASE')
    );
    if (criticalEnvVars.length > 0) {
      return 'building';
    }

    // Packaging: deploy works but GTM not ready
    const gtmReady = gtmChecks.deployGreen && 
                     gtmChecks.urlLoads && 
                     gtmChecks.hasReadme && 
                     gtmChecks.hasDemoAsset;
    
    if (!gtmReady) {
      return 'packaging';
    }

    // Ready to launch
    return 'ready_to_launch';
  }

  private computeOperationalBlocker(context: {
    deploymentId: string | null;
    deployStatus: string;
    errorLog: string | null;
    errorCategory: string | null;
    missingEnvVars: string[];
    envVarsConfigured: string[];
  }): Shortcoming | null {
    // Deploy error
    if (context.deployStatus === 'error' && context.errorLog) {
      const errorExcerpt = context.errorLog.split('\n')
        .find(l => l.toLowerCase().includes('error') || l.includes('failed'))
        ?.substring(0, 150) || context.errorLog.substring(0, 150);

      const evidence: EvidenceRef[] = [{
        kind: 'vercel_log',
        deploymentId: context.deploymentId || 'unknown',
        excerpt: errorExcerpt,
      }];

      return {
        issue: `Deploy failing (${context.errorCategory || 'unknown'} error)`,
        severity: 'critical',
        evidence,
        impact: 'Nothing works until this is fixed',
      };
    }

    // Missing critical env vars
    const criticalMissing = context.missingEnvVars.filter(v => 
      v.includes('API_KEY') || v.includes('SECRET') || v.includes('TOKEN') || v.includes('DATABASE')
    );

    if (criticalMissing.length > 0) {
      const evidence: EvidenceRef[] = [{
        kind: 'env_diff',
        missing: criticalMissing,
        configured: context.envVarsConfigured,
        source: '.env.example vs Vercel production env',
      }];

      return {
        issue: `Missing ${criticalMissing.length} critical env var${criticalMissing.length > 1 ? 's' : ''}: ${criticalMissing.slice(0, 3).join(', ')}`,
        severity: 'critical',
        evidence,
        impact: 'App will crash or fail to authenticate',
      };
    }

    // Building
    if (context.deployStatus === 'building') {
      return {
        issue: 'Deploy in progress',
        severity: 'minor',
        evidence: [],
        impact: 'Wait for build to complete',
      };
    }

    return null;
  }

  private computeGTMBlocker(gtmChecks: GTMReadinessChecks, gtmStage: GTMStage): Shortcoming | null {
    if (gtmStage === 'building') {
      return null; // Operational blocker takes priority
    }

    const issues: Array<{ issue: string; evidence: EvidenceRef }> = [];

    if (!gtmChecks.hasReadme) {
      issues.push({
        issue: 'No README',
        evidence: { kind: 'file_missing', path: 'README.md', expected: 'Project documentation with description and usage' },
      });
    }

    if (!gtmChecks.hasDemoAsset) {
      issues.push({
        issue: 'No demo screenshot',
        evidence: { kind: 'file_missing', path: 'screenshot', expected: 'Visual proof of what it does' },
      });
    }

    if (!gtmChecks.hasClearCTA && gtmChecks.hasReadme) {
      issues.push({
        issue: 'No clear CTA in README',
        evidence: { kind: 'code', path: 'README.md', lines: [1, 10], excerpt: 'Missing "try it" / "get started" / "install" section' },
      });
    }

    if (issues.length === 0) {
      return null;
    }

    return {
      issue: issues[0].issue,
      severity: gtmStage === 'packaging' ? 'major' : 'minor',
      evidence: [issues[0].evidence],
      impact: 'Not ready to share with your audience',
    };
  }

  private detectProjectType(
    keyFiles: { readme: string | null; packageJson: string | null; vercelJson: string | null },
    packageJson: Record<string, unknown> | null
  ): ProjectSnapshot['type'] {
    if (!packageJson) return 'unknown';

    const deps = {
      ...(packageJson.dependencies as Record<string, string> || {}),
      ...(packageJson.devDependencies as Record<string, string> || {}),
    };

    if (deps['next']) return 'nextjs-app';
    if (deps['react'] && (deps['react-dom'] || deps['vite'])) return 'react-app';
    if (packageJson.bin) return 'cli';
    if (packageJson.exports || packageJson.main) {
      const hasServerDeps = deps['express'] || deps['fastify'] || deps['hono'] || deps['koa'];
      if (!hasServerDeps) return 'library';
    }
    if (deps['express'] || deps['fastify'] || deps['hono'] || deps['koa']) {
      return 'node-service';
    }
    if (keyFiles.vercelJson || deps['astro'] || deps['eleventy']) {
      return 'static-site';
    }

    return 'unknown';
  }

  private extractEnvVars(keyFiles: { envExample: string | null; packageJson: string | null }): string[] {
    const envVars = new Set<string>();

    if (keyFiles.envExample) {
      const matches = keyFiles.envExample.match(/^([A-Z][A-Z0-9_]+)=/gm);
      matches?.forEach(m => envVars.add(m.replace('=', '')));
    }

    return Array.from(envVars);
  }

  private safeJsonParse(str: string): Record<string, unknown> | null {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  // ============ PUBLIC HELPERS ============

  getEnvVarsUrl(projectName: string): string {
    const teamPath = this.vercelTeamId || '';
    return `https://vercel.com/${teamPath}/${projectName}/settings/environment-variables`;
  }
}
