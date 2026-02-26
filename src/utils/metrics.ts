/**
 * Metric Formatting and Normalization Utilities
 *
 * Helpers for formatting Google Ads metrics into human-readable formats.
 */

/**
 * Format micros (Google Ads uses micros for monetary values: 1,000,000 = $1.00)
 */
export function microsToAmount(micros: number | string): number {
  const value = typeof micros === 'string' ? parseInt(micros, 10) : micros;
  return value / 1_000_000;
}

/**
 * Format a number as currency (USD)
 */
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Format a percentage
 */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Calculate CTR from impressions and clicks
 */
export function calculateCtr(impressions: number, clicks: number): number {
  if (impressions === 0) return 0;
  return clicks / impressions;
}

/**
 * Calculate CPC from cost (in micros) and clicks
 */
export function calculateCpc(costMicros: number, clicks: number): number {
  if (clicks === 0) return 0;
  return microsToAmount(costMicros) / clicks;
}

/**
 * Calculate CPM from cost (in micros) and impressions
 */
export function calculateCpm(costMicros: number, impressions: number): number {
  if (impressions === 0) return 0;
  return (microsToAmount(costMicros) / impressions) * 1000;
}

/**
 * Calculate ROAS from conversion value and cost
 */
export function calculateRoas(conversionValueMicros: number, costMicros: number): number {
  if (costMicros === 0) return 0;
  return conversionValueMicros / costMicros; // Both in micros, so ratio is correct
}

/**
 * Calculate video view rate from views and impressions
 */
export function calculateViewRate(videoViews: number, impressions: number): number {
  if (impressions === 0) return 0;
  return videoViews / impressions;
}

/**
 * Calculate CPV from cost (in micros) and video views
 */
export function calculateCpv(costMicros: number, videoViews: number): number {
  if (videoViews === 0) return 0;
  return microsToAmount(costMicros) / videoViews;
}

/**
 * Safe parse for numeric metric values from GAQL results
 */
export function safeParseNumber(value: any): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? 0 : parsed;
}
