/**
 * GAQL (Google Ads Query Language) Builder Helpers
 *
 * Utilities for building type-safe GAQL queries for Google Ads API.
 */

/**
 * Date range presets mapped to GAQL date conditions
 */
export type DateRange = 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d' | 'this_month' | 'last_month';

/**
 * Convert a date range preset to a GAQL WHERE clause
 */
export function dateRangeToGaql(dateRange: DateRange): string {
  switch (dateRange) {
    case 'last_7d':
      return `segments.date DURING LAST_7_DAYS`;
    case 'last_14d':
      return `segments.date DURING LAST_14_DAYS`;
    case 'last_30d':
      return `segments.date DURING LAST_30_DAYS`;
    case 'last_90d': {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 90);
      return `segments.date BETWEEN '${formatDate(start)}' AND '${formatDate(end)}'`;
    }
    case 'this_month':
      return `segments.date DURING THIS_MONTH`;
    case 'last_month':
      return `segments.date DURING LAST_MONTH`;
  }
}

/**
 * Convert a custom date range (start, end) to GAQL BETWEEN clause
 */
export function customDateRangeToGaql(startDate: string, endDate: string): string {
  return `segments.date BETWEEN '${startDate}' AND '${endDate}'`;
}

/**
 * Format a Date object as YYYY-MM-DD for GAQL
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get start and end dates for a date range preset
 */
export function getDateBounds(dateRange: DateRange): { start: string; end: string } {
  const end = new Date();
  const start = new Date();

  switch (dateRange) {
    case 'last_7d':
      start.setDate(start.getDate() - 7);
      break;
    case 'last_14d':
      start.setDate(start.getDate() - 14);
      break;
    case 'last_30d':
      start.setDate(start.getDate() - 30);
      break;
    case 'last_90d':
      start.setDate(start.getDate() - 90);
      break;
    case 'this_month':
      start.setDate(1);
      break;
    case 'last_month':
      start.setMonth(start.getMonth() - 1);
      start.setDate(1);
      end.setDate(0); // Last day of previous month
      break;
  }

  return { start: formatDate(start), end: formatDate(end) };
}

/**
 * Build a complete GAQL SELECT query
 */
export function buildGaqlQuery(options: {
  select: string[];
  from: string;
  where?: string[];
  orderBy?: string;
  limit?: number;
}): string {
  let query = `SELECT ${options.select.join(', ')} FROM ${options.from}`;

  if (options.where && options.where.length > 0) {
    query += ` WHERE ${options.where.join(' AND ')}`;
  }

  if (options.orderBy) {
    query += ` ORDER BY ${options.orderBy}`;
  }

  if (options.limit) {
    query += ` LIMIT ${options.limit}`;
  }

  return query;
}

/**
 * Campaign status filter for GAQL queries
 */
export function campaignStatusFilter(includeRemoved = false): string {
  if (includeRemoved) {
    return '';
  }
  return `campaign.status != 'REMOVED'`;
}
