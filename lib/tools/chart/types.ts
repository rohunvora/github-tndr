/**
 * Chart Analysis Types
 * SYNCED WITH bel-rtr - Do not add Telegram-specific types here
 */

export interface KeyZone {
  price: number;
  label: string;
  significance: string;
  type: 'support' | 'resistance';
  strength: 'weak' | 'moderate' | 'strong';
}

export interface Scenario {
  condition: string;
  implication: string;
}

export interface Regime {
  type: 'trending_up' | 'trending_down' | 'ranging' | 'breakout' | 'breakdown';
  confidence: number;
}

export interface RangeBox {
  high: number;
  low: number;
  confidence: number;
}

export interface PivotPoint {
  price: number;
  label: 'HH' | 'HL' | 'LH' | 'LL';
}

export interface Pivots {
  points: PivotPoint[];
  confidence: number;
}

export interface Fakeout {
  level: number;
  direction: 'above' | 'below';
  confidence: number;
}

export interface ChartAnalysis {
  story: string;
  currentContext: string;
  keyZones: KeyZone[];
  scenarios: Scenario[];
  invalidation: string;
  regime: Regime;
  rangeBox?: RangeBox;
  pivots?: Pivots;
  fakeouts?: Fakeout[];
  currentPrice: number;
  symbol?: string;
  timeframe?: string;
  analyzedAt: string;
  success: boolean;
  error?: string;
}

