import type { ChartAnalysis } from './analysis.js';

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
