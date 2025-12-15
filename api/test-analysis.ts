export const config = {
  runtime: 'edge',
};

import { Collector } from '../lib/collector.js';
import { Reasoner } from '../lib/reasoner.js';

export default async function handler(req: Request) {
  try {
    const collector = new Collector(
      process.env.GITHUB_TOKEN!,
      process.env.VERCEL_TOKEN!,
      process.env.VERCEL_TEAM_ID
    );

    const reasoner = new Reasoner(
      process.env.ANTHROPIC_API_KEY!,
      process.env.VERCEL_TEAM_ID
    );

    // Collect top projects
    const snapshots = await collector.collectTopProjects(3);

    if (snapshots.length === 0) {
      return new Response(JSON.stringify({ error: 'No active projects found' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Analyze each
    const analyses = await Promise.all(
      snapshots.map(async (snapshot) => {
        const assessment = await reasoner.analyze(snapshot);
        return {
          project: snapshot.name,
          gtmStage: snapshot.gtmStage,
          deployStatus: snapshot.deployment.status,
          deployUrl: snapshot.deployment.url,
          screenshotUrl: snapshot.screenshot.url,
          screenshotError: snapshot.screenshot.error,
          
          // GTM Checks
          gtmChecks: snapshot.gtmChecks,
          
          // Blockers
          operationalBlocker: snapshot.operationalBlocker,
          gtmBlocker: snapshot.gtmBlocker,
          missingEnvVars: snapshot.missingEnvVars,
          
          // Assessment
          actionType: assessment.actionType,
          nextAction: assessment.nextAction,
          shouldAutoMessage: assessment.shouldAutoMessage,
          autoMessageReason: assessment.autoMessageReason,
          
          // Artifacts (what the bot would send)
          artifacts: {
            cursorPrompt: assessment.artifacts.cursorPrompt?.substring(0, 500) || null,
            launchPost: assessment.artifacts.launchPost || null,
            envChecklist: assessment.artifacts.envChecklist || null,
          },
          
          // Example message the bot would send
          exampleMessage: formatExampleMessage(snapshot, assessment),
        };
      })
    );

    return new Response(JSON.stringify({
      projectCount: snapshots.length,
      analyses,
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function formatExampleMessage(snapshot: any, assessment: any): string {
  const stageMap: Record<string, string> = {
    'building': '🔨 Building',
    'packaging': '📦 Packaging',
    'ready_to_launch': '🚀 Ready to Launch',
    'launching': '📣 Launching',
    'post_launch': '📊 Post-Launch',
  };
  const stage = stageMap[snapshot.gtmStage] || '';

  let msg = `**${snapshot.name}** ${stage}\n\n`;
  
  if (assessment.primaryShortcoming) {
    msg += `${assessment.primaryShortcoming.issue}\n`;
    const evidence = assessment.primaryShortcoming.evidence?.[0];
    if (evidence?.kind === 'vercel_log') {
      msg += `\`${evidence.excerpt.substring(0, 80)}...\`\n`;
    } else if (evidence?.kind === 'env_diff') {
      msg += `Missing: \`${evidence.missing.slice(0, 3).join('`, `')}\`\n`;
    }
    msg += '\n';
  }
  
  if (snapshot.deployment.url) {
    msg += `🔗 ${snapshot.deployment.url}\n\n`;
  }

  switch (assessment.nextAction.artifact) {
    case 'cursor_prompt':
      msg += `Want a Cursor prompt to fix this?`;
      break;
    case 'launch_post':
      msg += `Ready to post? I can draft the announcement.`;
      break;
    case 'env_checklist':
      msg += `Need the env var checklist?`;
      break;
    default:
      msg += `What's next?`;
  }

  return msg;
}

