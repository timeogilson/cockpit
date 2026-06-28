// Pricing table — USD per 1,000,000 tokens.
//
// NOTE: These are EDITABLE ESTIMATES. Claude Code stores no local cost/usage
// cache, so Cockpit derives cost from token counts × these rates. Anthropic's
// published prices change over time and vary by tier — treat every number here
// as an approximation. A future slice (M2/M7) will let the user edit this table
// from the Config screen; for now adjust the constants below.
//
// Matching is longest-prefix-ish: we try an exact id, then a family prefix,
// then fall back to `default` (which flags the cost as `estimated`).

import type { TokenCounts } from './types';

export interface ModelRate {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cache-write (cache_creation) tokens. */
  cacheWrite: number;
  /** USD per 1M cache-read tokens. */
  cacheRead: number;
}

/** Exact-id rates (checked first). */
export const PRICING: Record<string, ModelRate> = {
  'claude-opus-4-8': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 }
};

/** Family-prefix rates (checked if no exact match). Order = priority. */
export const PRICING_PREFIXES: Array<{ prefix: string; rate: ModelRate }> = [
  { prefix: 'claude-opus', rate: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 } },
  { prefix: 'claude-sonnet', rate: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  { prefix: 'claude-3-5-sonnet', rate: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  { prefix: 'claude-3.5-sonnet', rate: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 } },
  { prefix: 'claude-haiku', rate: { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 } },
  { prefix: 'claude-3-5-haiku', rate: { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 } }
];

/** Fallback used for unknown models. Cost computed with this is flagged estimated. */
export const DEFAULT_RATE: ModelRate = {
  input: 5,
  output: 20,
  cacheWrite: 6.25,
  cacheRead: 0.5
};

export interface PricedCost {
  costUsd: number;
  /** True when DEFAULT_RATE (unknown model) was used. */
  estimated: boolean;
}

function rateFor(model: string): { rate: ModelRate; estimated: boolean } {
  const id = (model || '').toLowerCase();
  if (PRICING[id]) return { rate: PRICING[id], estimated: false };
  for (const { prefix, rate } of PRICING_PREFIXES) {
    if (id.startsWith(prefix)) return { rate, estimated: false };
  }
  return { rate: DEFAULT_RATE, estimated: true };
}

/** Cost = Σ(tokens × rate / 1e6). */
export function computeCost(model: string, tokens: TokenCounts): PricedCost {
  const { rate, estimated } = rateFor(model);
  const costUsd =
    (tokens.input * rate.input +
      tokens.output * rate.output +
      tokens.cacheWrite * rate.cacheWrite +
      tokens.cacheRead * rate.cacheRead) /
    1_000_000;
  return { costUsd, estimated };
}
