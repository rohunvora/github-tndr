/**
 * Chart Tool Telegram Handler
 * LOCAL ONLY - Not synced with bel-rtr
 */

import type { Context } from 'grammy';
import { InputFile } from 'grammy';
import { info, error as logErr } from '../../core/logger.js';
import { analyzeChart, annotateChart } from './analysis.js';
import { formatChartCaption, formatChartError } from './format.js';

/**
 * Handle photo messages - analyze chart images
 */
export async function handlePhoto(ctx: Context): Promise<void> {
  const chatId = process.env.USER_TELEGRAM_CHAT_ID;
  if (ctx.from?.id.toString() !== chatId) return;

  info('chart.handler', 'Received chart image', { from: ctx.from?.id });

  const chatIdNum = ctx.chat!.id;
  
  // Progress message
  const progressMsg = await ctx.reply('📥 Downloading chart...', { parse_mode: 'Markdown' });

  try {
    // Get the largest photo (last in array)
    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) {
      await ctx.api.editMessageText(chatIdNum, progressMsg.message_id, formatChartError('No photo found'));
      return;
    }

    const largestPhoto = photos[photos.length - 1];
    
    // Download the photo
    const file = await ctx.api.getFile(largestPhoto.file_id);
    const filePath = file.file_path;
    if (!filePath) {
      await ctx.api.editMessageText(chatIdNum, progressMsg.message_id, formatChartError('Could not download image'));
      return;
    }

    // Fetch the actual file
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
    const response = await fetch(fileUrl);
    if (!response.ok) {
      await ctx.api.editMessageText(chatIdNum, progressMsg.message_id, formatChartError('Failed to fetch image'));
      return;
    }

    // Convert to base64
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    info('chart.handler', 'Image downloaded', { size: `${(base64.length / 1024).toFixed(1)}KB` });

    // Step 1: Extract levels
    await ctx.api.editMessageText(chatIdNum, progressMsg.message_id, '📊 Extracting levels...');

    const analysis = await analyzeChart(base64);

    if (!analysis.success) {
      await ctx.api.editMessageText(chatIdNum, progressMsg.message_id, formatChartError(analysis.error || 'Analysis failed'));
      return;
    }

    if (analysis.keyZones.length === 0) {
      await ctx.api.editMessageText(chatIdNum, progressMsg.message_id, formatChartError('No zones detected'));
      return;
    }

    // Step 2: Annotate chart
    await ctx.api.editMessageText(
      chatIdNum, 
      progressMsg.message_id, 
      `🎨 Drawing ${analysis.keyZones.length} zone${analysis.keyZones.length !== 1 ? 's' : ''}...`
    );

    const annotatedBase64 = await annotateChart(base64, analysis);

    if (!annotatedBase64) {
      await ctx.api.editMessageText(chatIdNum, progressMsg.message_id, formatChartError('Annotation failed'));
      return;
    }

    // Send annotated image
    const imageBuffer = Buffer.from(annotatedBase64, 'base64');
    await ctx.replyWithPhoto(new InputFile(imageBuffer, 'chart-annotated.png'), {
      caption: formatChartCaption(analysis),
      parse_mode: 'Markdown',
    });

    // Delete progress message after image is sent
    try {
      await ctx.api.deleteMessage(chatIdNum, progressMsg.message_id);
    } catch {
      // Message may already be deleted
    }

    info('chart.handler', 'Annotation complete', { 
      symbol: analysis.symbol, 
      regime: analysis.regime.type,
      zones: analysis.keyZones.length 
    });

  } catch (err) {
    logErr('chart.handler', err);
    try {
      await ctx.api.editMessageText(
        chatIdNum,
        progressMsg.message_id,
        formatChartError(err instanceof Error ? err.message : 'Unknown error')
      );
    } catch {
      // Message may have been deleted
    }
  }
}

