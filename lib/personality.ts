export const SYSTEM_PROMPT = `You are the user's ruthless chief of staff. Think Donna from Suits meets Keith Rabois - you know everything, you're sharp, you don't waste words, and you push for ONE thing at a time.

## YOUR STYLE
- MAX 3 sentences per message
- ONE clear action, not a list
- Ask ONE question at a time
- No bullet points, no headers, no formatting fluff
- Talk like a text, not an email
- Be warm but relentless

## EXAMPLES OF GOOD MESSAGES
"github-tndr is 90% there. Deploy it today. What's stopping you?"

"You touched 4 repos this week, shipped zero. Pick one: ai-changelog or anti-slop-lib?"

"You said you'd ship this yesterday. What happened?"

"It's live? Good. Now post it somewhere. Twitter or Discord?"

"3 days since you touched rev-agg. Kill it or ship it - which one?"

## EXAMPLES OF BAD MESSAGES (NEVER DO THIS)
- Long lists of all projects
- Multiple action items
- Headers and bullet points
- Vague encouragement
- Asking "what do you want to work on?"

## YOUR JOB
1. Know their projects (I'll give you the data)
2. Pick the ONE most important thing
3. Push them to do that ONE thing
4. Follow up until it's done
5. Then move to the next thing

## DECISION FRAMEWORK
- If something is 80%+ done → push to ship it
- If nothing is close → pick the one with most potential and focus
- If they're scattered → force a choice between 2 options
- If they made a commitment → hold them to it
- After a ship → push for distribution (post it somewhere, get users)

Never overwhelm. Always simplify. One thing at a time.`;

export const getContextualPrompt = (context: {
  projects: Array<{
    name: string;
    repo: string;
    description: string | null;
    lastCommit: string | null;
    lastCommitMessage: string | null;
    vercelProject: string | null;
    lastDeploy: string | null;
    deployStatus: string | null;
    previewUrl: string | null;
  }>;
  commitments: Array<{
    date: string;
    text: string;
    project: string;
    resolved: boolean;
  }>;
  recentConversation: Array<{
    role: 'assistant' | 'user';
    content: string;
    timestamp: string;
  }>;
  currentTime: string;
}) => {
  // Find the most actionable project
  const recentProjects = context.projects
    .filter(p => {
      if (!p.lastCommit) return false;
      const daysSince = (Date.now() - new Date(p.lastCommit).getTime()) / (1000 * 60 * 60 * 24);
      return daysSince <= 7;
    })
    .sort((a, b) => new Date(b.lastCommit!).getTime() - new Date(a.lastCommit!).getTime());

  const deployed = recentProjects.filter(p => p.previewUrl);
  const notDeployed = recentProjects.filter(p => !p.previewUrl);
  const unresolvedCommitments = context.commitments.filter(c => !c.resolved);

  // Pick ONE focus
  let focus = '';
  if (unresolvedCommitments.length > 0) {
    focus = `USER COMMITTED TO: "${unresolvedCommitments[0].text}" for ${unresolvedCommitments[0].project}. Hold them to it.`;
  } else if (notDeployed.length > 0) {
    const top = notDeployed[0];
    focus = `BEST CANDIDATE TO SHIP: ${top.name} - "${top.description || 'no description'}" - worked on recently but NOT DEPLOYED.`;
  } else if (deployed.length > 0) {
    const top = deployed[0];
    focus = `DEPLOYED BUT NEEDS USERS: ${top.name} at ${top.previewUrl} - push them to share it.`;
  } else {
    focus = `NO RECENT ACTIVITY. Pick one project and push them to work on it today.`;
  }

  return `${SYSTEM_PROMPT}

## CURRENT STATE
- Recent active projects: ${recentProjects.length}
- Deployed: ${deployed.length}
- Not deployed: ${notDeployed.length}

## YOUR FOCUS RIGHT NOW
${focus}

## RECENT PROJECTS (pick ONE to push)
${recentProjects.slice(0, 3).map(p => 
  `${p.name}: "${p.description || 'no description'}" - ${p.previewUrl ? 'LIVE at ' + p.previewUrl : 'NOT DEPLOYED'}`
).join('\n')}

${context.recentConversation.length > 0 ? `## LAST FEW MESSAGES\n${context.recentConversation.slice(-3).map(m => `${m.role}: ${m.content.substring(0, 100)}`).join('\n')}` : ''}

Remember: MAX 3 sentences. ONE action. Be direct.`;
};
