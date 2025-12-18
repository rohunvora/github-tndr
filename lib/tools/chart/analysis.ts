/**
 * Chart Analysis Core Logic
 * SYNCED WITH bel-rtr - Keep this file focused on pure analysis
 */

import { info, error as logErr } from '../../core/logger.js';
import { getGoogleClient, MODELS } from '../../core/config.js';
import type { ChartAnalysis, KeyZone, Scenario, Regime, RangeBox, Pivots, Fakeout } from './types.js';

// ============================================
// PROMPT
// ============================================

const CHART_ANALYSIS_PROMPT = `You are a chart reader helping someone understand what a chart is telling them. Your job is NOT to predict prices - it's to explain what has happened and what to watch for next.

=== LAYER 1: CORE (REQUIRED) ===

STEP 1: TELL THE STORY
Look at the chart and describe what happened like you're explaining it to a friend:
- "This thing pumped from $X to $Y, then crashed back to $Z..."
- "It's been stuck between these two levels for weeks..."
- "There was a breakdown from $X, and it's been bleeding since..."

Be specific with prices you can READ FROM THE Y-AXIS. Use ACTUAL wick highs/lows, not round numbers.

STEP 2: IDENTIFY KEY ZONES (REQUIRED: 2-4)
It is IMPOSSIBLE for a chart to have 0 key zones. You MUST identify at least 2 levels where price reacted.
- If trending: Mark the trend start (support) and recent high/low (resistance/support).
- If ranging: Mark the range high (resistance) and range low (support).
- If breakout: Mark the breakout level (now support).
- If price is testing a level, that level IS a key zone.

CRITICAL: Read the ACTUAL price from the Y-axis.

STEP 3: CONDITIONAL SCENARIOS (not predictions)
Give 2 conditional scenarios using "If... then..." format:
Don't predict targets. Describe what it would MEAN if something happens.

STEP 4: INVALIDATION
What would completely change your read on this chart?

=== LAYER 2: REGIME (REQUIRED) ===

Classify the current market regime:
- "trending_up": Making higher highs and higher lows
- "trending_down": Making lower highs and lower lows  
- "ranging": Oscillating between defined support and resistance
- "breakout": Just broke above prior resistance, continuation expected
- "breakdown": Just broke below prior support, continuation expected

Include your confidence (0.0 to 1.0) in this classification.

=== LAYER 3: DETAILED PATTERN SCAN (CONTEXT AWARE) ===

RANGE BOX (Required if Regime is "Ranging"):
- If "ranging", you MUST define the box: high (resistance) and low (support).
- If not ranging, set to null.

PIVOTS (Required if Regime is "Trending"):
- If "trending", you MUST identify the 2-3 most recent swing points (HH, HL, LH, LL).
- If not trending, set to null.

FAKEOUTS (Scan Aggressively):
- Look for wicks that poked through a level and closed back inside.
- If seen, record them. This is high-value alpha.

USER'S QUESTION: {USER_QUESTION}

Respond with ONLY valid JSON (no markdown, no code blocks):

{
  "story": "<2-3 sentences describing WHAT HAPPENED. Be specific with ACTUAL prices from Y-axis.>",
  
  "currentContext": "<1 sentence on where price is NOW.>",
  
  "keyZones": [
    {
      "price": <EXACT number from Y-axis>,
      "label": "<short label: 'Pump high', 'Crash low', 'Range resistance', 'Prior breakdown'>",
      "significance": "<why this zone matters: 'Rejected 3x in March', 'Breakdown origin', 'Bounce zone'>",
      "type": "<'support'|'resistance'>",
      "strength": "<'weak' if 1 touch, 'moderate' if 2, 'strong' if 3+>"
    }
  ],
  
  "scenarios": [
    {
      "condition": "<If price does X... - be specific with a price level>",
      "implication": "<...then it suggests Y. What does that MEAN, not where will it GO>"
    },
    {
      "condition": "<If price does X instead...>",
      "implication": "<...then it suggests Y>"
    }
  ],
  
  "invalidation": "<What would completely invalidate this read?>",
  
  "regime": {
    "type": "<'trending_up'|'trending_down'|'ranging'|'breakout'|'breakdown'>",
    "confidence": <0.0 to 1.0>
  },
  
  "rangeBox": <If ranging: { "high": <price>, "low": <price>, "confidence": 0.9 } | else: null>,
  
  "pivots": <If trending: { "points": [{ "price": <num>, "label": "<HH|HL|LH|LL>" }], "confidence": 0.9 } | else: null>,
  
  "fakeouts": <If fakeouts visible: [{ "level": <price>, "direction": "<above|below>", "confidence": 0.9 }] | else: null>,
  
  "currentPrice": <exact number from chart>,
  "symbol": "<ticker if visible, null if not>",
  "timeframe": "<timeframe if visible, null if not>"
}

HARD RULES (DO NOT BREAK):
1. READ ACTUAL PRICES FROM Y-AXIS - not round numbers.
2. keyZones must be zones where price REACTED in the past.
3. You MUST identify at least 2 keyZones. Never 0.
4. If you mention a price level in the 'story', it MUST be included in 'keyZones'.
5. If regime is Ranging, rangeBox is REQUIRED.
6. If regime is Trending, pivots are REQUIRED.`;

// ============================================
// ANNOTATION PROMPT
// ============================================

const ANNOTATION_SYSTEM_INSTRUCTION = `You are a professional technical-analysis chart markup artist.

Your job is to edit a candlestick chart by overlaying clean, high-signal annotations that highlight key levels and patterns.

PRIMARY GOAL: Draw horizontal zones at the SPECIFIC PRICE LEVELS provided. A trader should look at your annotated chart and immediately see "these are the key levels to watch."

REQUIRED ELEMENTS:
1. SUPPORT ZONES: Draw semi-transparent GREEN horizontal bands at support prices
2. RESISTANCE ZONES: Draw semi-transparent RED horizontal bands at resistance prices  
3. LABELS: Add small text labels near each zone (e.g., "Support $10", "Resistance $45")

ZONE STYLE:
- Zones should be semi-transparent bands (not just lines) - about 2-3% price height
- GREEN/CYAN for support zones
- RED/PINK for resistance zones
- Zones must span the full width of the chart area
- Candles MUST remain visible through the zones
- Labels should be positioned near the right edge of the chart

CRITICAL RULES:
1. You MUST draw zones at the EXACT price levels provided in the brief
2. Read the Y-axis to place zones accurately
3. Do NOT redraw or distort the candles
4. Do NOT add arrows, trend lines, or projections
5. Keep it clean - zones and labels only

Return a single edited image with the overlays applied.`;

// ============================================
// MAIN ANALYSIS FUNCTION
// ============================================

export async function analyzeChart(
  imageBase64: string,
  userQuestion?: string
): Promise<ChartAnalysis> {
  info('chart', 'Analysis started', { imageSize: `${(imageBase64.length / 1024).toFixed(1)}KB` });

  let client;
  try {
    client = getGoogleClient();
  } catch (err) {
    return createEmptyAnalysis(err instanceof Error ? err.message : 'API key not configured');
  }

  const question = userQuestion || 'What\'s the story on this chart? What are the key levels and what should I watch for?';

  try {
    const startTime = Date.now();
    const response = await client.models.generateContent({
      model: MODELS.google.flash,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: imageBase64,
              },
            },
            { text: CHART_ANALYSIS_PROMPT.replace('{USER_QUESTION}', question) },
          ],
        },
      ],
    });

    info('chart', 'API response', { duration: `${Date.now() - startTime}ms` });

    const parts = response.candidates?.[0]?.content?.parts || [];
    let text = '';
    for (const part of parts) {
      if (part.text) text += part.text;
    }

    return parseAnalysisResponse(text);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to analyze chart';
    logErr('chart', 'API error', { error: errorMessage });
    return createEmptyAnalysis(errorMessage);
  }
}

// ============================================
// ANNOTATION FUNCTION
// ============================================

export async function annotateChart(
  imageBase64: string,
  analysis: ChartAnalysis
): Promise<string | null> {
  info('chart', 'Annotation started', { zones: analysis.keyZones.length });

  if (analysis.keyZones.length === 0) {
    logErr('chart', 'No zones to annotate');
    return null;
  }

  let client;
  try {
    client = getGoogleClient();
  } catch (err) {
    logErr('chart', 'API key not configured for annotation');
    return null;
  }

  // Build zone instructions
  const zoneInstructions = analysis.keyZones.map(zone => {
    const color = zone.type === 'support' ? 'GREEN' : 'RED';
    return `- ${color} zone at $${zone.price} (${zone.label})`;
  }).join('\n');

  const userPrompt = `Add support and resistance zones to this chart.

ZONES TO DRAW (read the Y-axis to place these accurately):
${zoneInstructions}

Current price: $${analysis.currentPrice}

INSTRUCTIONS:
1. Draw HORIZONTAL semi-transparent bands at each price level listed above
2. GREEN/CYAN bands for support levels
3. RED/PINK bands for resistance levels
4. Each zone should be a band about 2-3% of the price range in height
5. Add a small label near the right edge of each zone with the price
6. Zones must span the full width of the chart
7. Keep candles visible through the zones (semi-transparent)
8. NO arrows, NO projections, NO trend lines - just horizontal zones

The goal is a clean chart where a trader can immediately see the key price levels.`;

  const fullPrompt = `${ANNOTATION_SYSTEM_INSTRUCTION}\n\n---\n\nUSER REQUEST:\n${userPrompt}`;

  try {
    const startTime = Date.now();
    const response = await client.models.generateContent({
      model: MODELS.google.imageGen,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: imageBase64,
              },
            },
            { text: fullPrompt },
          ],
        },
      ],
      config: {
        responseModalities: ['IMAGE'],
      },
    });

    info('chart', 'Annotation API response', { duration: `${Date.now() - startTime}ms` });

    const parts = response.candidates?.[0]?.content?.parts || [];
    
    for (const part of parts) {
      if (part.inlineData?.data) {
        info('chart', 'Annotation complete', { 
          size: `${(part.inlineData.data.length / 1024).toFixed(1)}KB` 
        });
        return part.inlineData.data;
      }
    }

    logErr('chart', 'No image data in annotation response');
    return null;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logErr('chart', 'Annotation failed', { error: errorMessage });
    return null;
  }
}

// ============================================
// HELPERS
// ============================================

function parseAnalysisResponse(text: string): ChartAnalysis {
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const currentPrice = parsed.currentPrice || 0;

    // Validate and filter key zones
    let keyZones: KeyZone[] = (parsed.keyZones || []).slice(0, 4);
    keyZones = keyZones.filter(z => {
      if (z.price <= 0) return false;
      if (currentPrice > 0 && z.price > currentPrice * 10) return false;
      return true;
    });

    // Parse scenarios
    let scenarios: Scenario[] = (parsed.scenarios || []).slice(0, 2);
    scenarios = scenarios.map(s => ({
      condition: s.condition || 'If price action changes...',
      implication: s.implication || '...the thesis would need to be re-evaluated',
    }));
    while (scenarios.length < 2) {
      scenarios.push({
        condition: 'Unable to determine',
        implication: 'Need more price action for clarity',
      });
    }

    // Parse regime
    const rawRegime = parsed.regime || { type: 'ranging', confidence: 0.5 };
    const regime: Regime = {
      type: rawRegime.type || 'ranging',
      confidence: Math.min(1, Math.max(0, rawRegime.confidence || 0.5)),
    };

    // Parse optional patterns
    let rangeBox: RangeBox | undefined;
    if (parsed.rangeBox && parsed.rangeBox.confidence >= 0.6) {
      rangeBox = {
        high: parsed.rangeBox.high,
        low: parsed.rangeBox.low,
        confidence: parsed.rangeBox.confidence,
      };
    }

    let pivots: Pivots | undefined;
    if (parsed.pivots && parsed.pivots.confidence >= 0.6 && parsed.pivots.points?.length > 0) {
      pivots = {
        points: parsed.pivots.points.map((p: { price: number; label: string }) => ({
          price: p.price,
          label: p.label as 'HH' | 'HL' | 'LH' | 'LL',
        })),
        confidence: parsed.pivots.confidence,
      };
    }

    let fakeouts: Fakeout[] | undefined;
    if (parsed.fakeouts && Array.isArray(parsed.fakeouts) && parsed.fakeouts.length > 0) {
      const validFakeouts = parsed.fakeouts.filter((f: Fakeout) => f.confidence >= 0.6);
      if (validFakeouts.length > 0) {
        fakeouts = validFakeouts.map((f: Fakeout) => ({
          level: f.level,
          direction: f.direction as 'above' | 'below',
          confidence: f.confidence,
        }));
      }
    }

    const analysis: ChartAnalysis = {
      story: parsed.story || 'Unable to read chart story',
      currentContext: parsed.currentContext || 'Current position unclear',
      keyZones,
      scenarios,
      invalidation: parsed.invalidation || 'Invalidation level not identified',
      regime,
      rangeBox,
      pivots,
      fakeouts,
      currentPrice,
      symbol: parsed.symbol || undefined,
      timeframe: parsed.timeframe || undefined,
      analyzedAt: new Date().toISOString(),
      success: true,
    };

    info('chart', 'Analysis complete', {
      symbol: analysis.symbol,
      regime: analysis.regime.type,
      zones: analysis.keyZones.length,
    });

    return analysis;
  } catch (parseError) {
    logErr('chart', 'JSON parse failed', { error: parseError });
    return createEmptyAnalysis('Failed to parse AI response');
  }
}

function createEmptyAnalysis(error?: string): ChartAnalysis {
  return {
    story: error || 'Unable to analyze chart',
    currentContext: 'Unknown',
    keyZones: [],
    scenarios: [
      { condition: 'Unable to determine', implication: 'Analysis failed' },
      { condition: 'Unable to determine', implication: 'Analysis failed' },
    ],
    invalidation: 'Unknown',
    regime: { type: 'ranging', confidence: 0 },
    currentPrice: 0,
    analyzedAt: new Date().toISOString(),
    success: false,
    error,
  };
}

