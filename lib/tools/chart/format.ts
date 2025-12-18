/**
 * Chart Formatting for Telegram
 * LOCAL ONLY - Not synced with bel-rtr
 */

import type { ChartAnalysis } from './types.js';

/**
 * Format a simple caption for the annotated chart image
 */
export function formatChartCaption(analysis: ChartAnalysis): string {
  const header = analysis.symbol || 'Chart';
  const tf = analysis.timeframe ? ` ${analysis.timeframe}` : '';
  const zones = analysis.keyZones.length;
  return `${header}${tf} · ${zones} zone${zones !== 1 ? 's' : ''}`;
}

/**
 * Format error message
 */
export function formatChartError(error: string): string {
  return `❌ ${error}`;
}

/**
 * Format detailed analysis as Telegram message
 */
export function formatChartDetails(analysis: ChartAnalysis): string {
  if (!analysis.success) {
    return `❌ **Analysis Failed**\n${analysis.error || 'Unknown error'}`;
  }

  const lines: string[] = [];

  // Header
  const header = analysis.symbol ? `📊 **${analysis.symbol}**` : '📊 **Chart Analysis**';
  if (analysis.timeframe) {
    lines.push(`${header} (${analysis.timeframe})`);
  } else {
    lines.push(header);
  }
  lines.push('');

  // Story
  lines.push(`📖 ${analysis.story}`);
  lines.push('');

  // Current context
  lines.push(`📍 ${analysis.currentContext}`);
  lines.push('');

  // Regime
  const regimeEmoji = {
    trending_up: '📈',
    trending_down: '📉',
    ranging: '↔️',
    breakout: '🚀',
    breakdown: '💥',
  }[analysis.regime.type] || '❓';
  lines.push(`${regimeEmoji} **Regime:** ${analysis.regime.type.replace('_', ' ')} (${Math.round(analysis.regime.confidence * 100)}% confidence)`);
  lines.push('');

  // Key zones
  if (analysis.keyZones.length > 0) {
    lines.push('**Key Zones:**');
    for (const zone of analysis.keyZones) {
      const emoji = zone.type === 'support' ? '🟢' : '🔴';
      lines.push(`${emoji} $${zone.price.toLocaleString()} - ${zone.label}`);
    }
    lines.push('');
  }

  // Scenarios
  if (analysis.scenarios.length > 0) {
    lines.push('**Scenarios:**');
    for (const scenario of analysis.scenarios) {
      lines.push(`• ${scenario.condition}`);
      lines.push(`  → ${scenario.implication}`);
    }
    lines.push('');
  }

  // Invalidation
  lines.push(`⚠️ **Invalidation:** ${analysis.invalidation}`);

  return lines.join('\n');
}

