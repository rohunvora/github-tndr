import { Context } from 'grammy';
import { info, error as logErr } from '../../core/logger.js';
import { stateManager } from '../../core/state.js';

/**
 * Handle /watch <repo> - enable push notifications for a repo
 * Accepts both "name" and "owner/name" formats
 */
export async function handleWatch(ctx: Context, repoInput: string): Promise<void> {
  info('watch', 'Starting', { repo: repoInput });
  
  try {
    let fullName = repoInput;
    
    // If already in owner/name format, use directly
    if (repoInput.includes('/')) {
      fullName = repoInput;
      info('watch', 'Using owner/name format directly', { fullName });
    } else {
      // Try to find in tracked repos by name
      const tracked = await stateManager.getTrackedRepoByName(repoInput);
      if (tracked) {
        fullName = `${tracked.owner}/${tracked.name}`;
        info('watch', 'Found tracked repo', { fullName });
      } else {
        // Can't resolve - ask for full name
        await ctx.reply(`❌ Repo "${repoInput}" not tracked.\n\nEither:\n• Run \`/repo ${repoInput}\` first, or\n• Use full format: \`/watch owner/${repoInput}\``, {
          parse_mode: 'Markdown',
        });
        info('watch', 'Not found', { repoInput });
        return;
      }
    }
    
    // Add to watch list
    await stateManager.addWatchedRepo(fullName);
    
    await ctx.reply(`👁️ Watching **${fullName}**\n\nYou'll get notified when:\n• Files from cut list are deleted\n• README changes\n• Blockers are resolved\n\nUse \`/unwatch ${fullName.split('/')[1]}\` to stop.`, {
      parse_mode: 'Markdown',
    });
    
    info('watch', 'SUCCESS', { fullName });
    
  } catch (err) {
    logErr('watch', err, { repo: repoInput });
    await ctx.reply(`❌ Failed to watch: ${err instanceof Error ? err.message : 'error'}`);
  }
}

/**
 * Handle /unwatch <repo> - disable push notifications
 */
export async function handleUnwatch(ctx: Context, repoInput: string): Promise<void> {
  info('unwatch', 'Removing watch', { repo: repoInput });
  
  try {
    let fullName = repoInput;
    if (!repoInput.includes('/')) {
      const tracked = await stateManager.getTrackedRepoByName(repoInput);
      if (tracked) {
        fullName = `${tracked.owner}/${tracked.name}`;
      }
    }
    
    await stateManager.removeWatchedRepo(fullName);
    
    await ctx.reply(`🔇 Stopped watching **${fullName}**`, { parse_mode: 'Markdown' });
    
    info('unwatch', 'Removed', { fullName });
    
  } catch (err) {
    logErr('unwatch', err, { repo: repoInput });
    await ctx.reply(`❌ Failed: ${err instanceof Error ? err.message : 'error'}`);
  }
}

/**
 * Handle /watching - list all watched repos
 */
export async function handleWatching(ctx: Context): Promise<void> {
  info('watching', 'Listing watched repos');
  
  try {
    const watched = await stateManager.getWatchedRepos();
    
    if (watched.length === 0) {
      await ctx.reply(`No repos being watched.\n\nUse /watch <repo> to start.`);
      return;
    }
    
    const list = watched.map((r: string) => `• ${r}`).join('\n');
    await ctx.reply(`👁️ **Watching ${watched.length} repos:**\n\n${list}\n\nUse /unwatch <repo> to stop.`, {
      parse_mode: 'Markdown',
    });
    
  } catch (err) {
    logErr('watching', err);
    await ctx.reply(`❌ Failed: ${err instanceof Error ? err.message : 'error'}`);
  }
}

/**
 * Handle mute callback - mute push notifications for a duration
 */
export async function handleMute(ctx: Context, fullName: string, duration: string): Promise<void> {
  info('mute', 'Muting', { fullName, duration });
  
  try {
    let muteUntil: Date;
    switch (duration) {
      case '1d':
        muteUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
        break;
      case '1w':
        muteUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        break;
      case 'forever':
        // Just remove from watch list
        await stateManager.removeWatchedRepo(fullName);
        await ctx.answerCallbackQuery({ text: `Stopped watching ${fullName.split('/')[1]}` });
        return;
      default:
        muteUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }
    
    await stateManager.muteWatchedRepo(fullName, muteUntil.toISOString());
    
    const durationLabel = duration === '1d' ? '1 day' : duration === '1w' ? '1 week' : duration;
    await ctx.answerCallbackQuery({ text: `Muted ${fullName.split('/')[1]} for ${durationLabel}` });
    
  } catch (err) {
    logErr('mute', err, { fullName, duration });
    await ctx.answerCallbackQuery({ text: 'Failed to mute' });
  }
}

