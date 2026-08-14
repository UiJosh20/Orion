export interface ProfitBreakdown {
  profitUSD: number;
  lossUSD: number;
  profitPips: number | null; // null for assets where "pips" isn't a meaningful unit (crypto)
  lossPips: number | null;
}

/**
 * Pip size depends on the asset. Forex majors use 0.0001, JPY pairs use 0.01.
 * Crypto doesn't have a standardized "pip" — we return null and the UI
 * should show price points instead.
 */
function getPipSize(symbol: string): number | null {
  const s = symbol.toUpperCase();
  const isForex = /^(EUR|GBP|USD|JPY|AUD|CAD|CHF|NZD)(EUR|GBP|USD|JPY|AUD|CAD|CHF|NZD)$/.test(s);
  if (!isForex) return null;
  return s.endsWith('JPY') ? 0.01 : 0.0001;
}

export function calculateProfitBreakdown(
  symbol: string,
  entry: number,
  stopLoss: number,
  target: number,
  positionSize: number
): ProfitBreakdown {
  const profitUSD = Math.abs(target - entry) * positionSize;
  const lossUSD = Math.abs(entry - stopLoss) * positionSize;

  const pipSize = getPipSize(symbol);
  const profitPips = pipSize ? Number((Math.abs(target - entry) / pipSize).toFixed(1)) : null;
  const lossPips = pipSize ? Number((Math.abs(entry - stopLoss) / pipSize).toFixed(1)) : null;

  return { profitUSD, lossUSD, profitPips, lossPips };
}