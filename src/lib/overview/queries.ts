// ---------------------------------------------------------------------------
// BigQuery queries for platform-wide overview
// ---------------------------------------------------------------------------

import { getClient } from "@/lib/citrusad/bigquery";

const LOCATION = "europe-west3";
const DATASET = "insight-platform-external-iam.alza_eu2_analytics";

async function q<T>(sql: string, params: Record<string, string>): Promise<T[]> {
  const bq = getClient();
  const types: Record<string, string> = {};
  for (const key of Object.keys(params)) types[key] = "STRING";
  const [rows] = await bq.query({ query: sql, params, types, location: LOCATION });
  return rows as T[];
}

// Q1: Weekly metrics by country (for the entire year or custom range)
export async function queryWeeklyByCountry(dateFrom: string, dateTo: string) {
  const sql = `
    SELECT
      DATE_TRUNC(r.ingressed_at, WEEK(MONDAY)) AS week_start,
      COALESCE(c.currency_code, 'CZK') AS currency,
      COUNT(DISTINCT r.supplier_id) AS active_vendors,
      COUNT(DISTINCT r.campaign_id) AS active_campaigns,
      ROUND(SUM(r.ad_spend), 2) AS obrat,
      ROUND(SUM(r.sales_revenue), 2) AS sales_revenue
    FROM \`${DATASET}.fact_realised_ad_agg\` r
    LEFT JOIN (
      SELECT campaign_id, currency_code FROM \`${DATASET}.dim_campaign\` WHERE is_current = true
    ) c ON r.campaign_id = c.campaign_id
    WHERE r.ingressed_at >= PARSE_DATE('%Y-%m-%d', @dateFrom)
      AND r.ingressed_at <= PARSE_DATE('%Y-%m-%d', @dateTo)
    GROUP BY week_start, currency
    ORDER BY week_start, currency
  `;
  return q<{
    week_start: { value: string } | string;
    currency: string;
    active_vendors: number;
    active_campaigns: number;
    obrat: number;
    sales_revenue: number;
  }>(sql, { dateFrom, dateTo });
}

// Q1b: Weekly deduplicated vendor count (across all markets)
export async function queryWeeklyGlobalVendors(dateFrom: string, dateTo: string) {
  const sql = `
    SELECT
      DATE_TRUNC(r.ingressed_at, WEEK(MONDAY)) AS week_start,
      COUNT(DISTINCT r.supplier_id) AS unique_vendors
    FROM \`${DATASET}.fact_realised_ad_agg\` r
    WHERE r.ingressed_at >= PARSE_DATE('%Y-%m-%d', @dateFrom)
      AND r.ingressed_at <= PARSE_DATE('%Y-%m-%d', @dateTo)
    GROUP BY week_start
    ORDER BY week_start
  `;
  return q<{
    week_start: { value: string } | string;
    unique_vendors: number;
  }>(sql, { dateFrom, dateTo });
}

// Q1c: Quarterly actuals by calendar quarter (precise, not derived from weeks)
export async function queryQuarterlyActuals(dateFrom: string, dateTo: string) {
  const sql = `
    SELECT
      EXTRACT(QUARTER FROM r.ingressed_at) AS q,
      COALESCE(c.currency_code, 'CZK') AS currency,
      ROUND(SUM(r.ad_spend), 2) AS obrat
    FROM \`${DATASET}.fact_realised_ad_agg\` r
    LEFT JOIN (
      SELECT campaign_id, currency_code FROM \`${DATASET}.dim_campaign\` WHERE is_current = true
    ) c ON r.campaign_id = c.campaign_id
    WHERE r.ingressed_at >= PARSE_DATE('%Y-%m-%d', @dateFrom)
      AND r.ingressed_at <= PARSE_DATE('%Y-%m-%d', @dateTo)
    GROUP BY q, currency
    ORDER BY q
  `;
  return q<{
    q: number;
    currency: string;
    obrat: number;
  }>(sql, { dateFrom, dateTo });
}

// Q2a: Daily deduplicated vendor + campaign count (across all markets)
export async function queryDailyGlobalCounts(dateTo: string) {
  const sql = `
    SELECT
      r.ingressed_at AS d,
      COUNT(DISTINCT r.supplier_id) AS unique_vendors,
      COUNT(DISTINCT r.campaign_id) AS unique_campaigns
    FROM \`${DATASET}.fact_realised_ad_agg\` r
    WHERE r.ingressed_at >= DATE_SUB(PARSE_DATE('%Y-%m-%d', @dateTo), INTERVAL 60 DAY)
      AND r.ingressed_at <= PARSE_DATE('%Y-%m-%d', @dateTo)
    GROUP BY d
    ORDER BY d
  `;
  return q<{
    d: { value: string } | string;
    unique_vendors: number;
    unique_campaigns: number;
  }>(sql, { dateTo });
}

// Q2b: Daily metrics by currency (for obrat/ROAS conversion)
export async function queryDailyOverview(dateTo: string) {
  const sql = `
    SELECT
      r.ingressed_at AS d,
      COALESCE(c.currency_code, 'CZK') AS currency,
      COUNT(DISTINCT r.supplier_id) AS active_vendors,
      COUNT(DISTINCT r.campaign_id) AS active_campaigns,
      ROUND(SUM(r.ad_spend), 2) AS obrat,
      ROUND(SUM(r.sales_revenue), 2) AS sales_revenue
    FROM \`${DATASET}.fact_realised_ad_agg\` r
    LEFT JOIN (
      SELECT campaign_id, currency_code FROM \`${DATASET}.dim_campaign\` WHERE is_current = true
    ) c ON r.campaign_id = c.campaign_id
    WHERE r.ingressed_at >= DATE_SUB(PARSE_DATE('%Y-%m-%d', @dateTo), INTERVAL 60 DAY)
      AND r.ingressed_at <= PARSE_DATE('%Y-%m-%d', @dateTo)
    GROUP BY d, currency
    ORDER BY d
  `;
  return q<{
    d: { value: string } | string;
    currency: string;
    active_vendors: number;
    active_campaigns: number;
    obrat: number;
    sales_revenue: number;
  }>(sql, { dateTo });
}

// Q4: Top vendors by yesterday's ad_spend, with day-before comparison
export async function queryDailyTopVendors(dateTo: string) {
  const sql = `
    SELECT
      r.supplier_id,
      t.team_name,
      r.ingressed_at AS d,
      COALESCE(c.currency_code, 'CZK') AS currency,
      ROUND(SUM(r.ad_spend), 2) AS obrat
    FROM \`${DATASET}.fact_realised_ad_agg\` r
    LEFT JOIN (
      SELECT campaign_id, currency_code FROM \`${DATASET}.dim_campaign\` WHERE is_current = true
    ) c ON r.campaign_id = c.campaign_id
    LEFT JOIN (
      SELECT team_id, team_name FROM \`${DATASET}.dim_team\` WHERE is_current = true AND team_type = 'SUPPLIER'
    ) t ON r.supplier_id = t.team_id
    WHERE r.ingressed_at >= DATE_SUB(PARSE_DATE('%Y-%m-%d', @dateTo), INTERVAL 2 DAY)
      AND r.ingressed_at <= PARSE_DATE('%Y-%m-%d', @dateTo)
    GROUP BY r.supplier_id, t.team_name, r.ingressed_at, c.currency_code
  `;
  return q<{
    supplier_id: string;
    team_name: string;
    d: { value: string } | string;
    currency: string;
    obrat: number;
  }>(sql, { dateTo });
}

// Q3: Top vendors by revenue (last 2 full weeks for WoW comparison)
export async function queryTopVendors(dateTo: string) {
  const sql = `
    WITH last_two_weeks AS (
      SELECT
        r.supplier_id,
        t.team_name,
        DATE_TRUNC(r.ingressed_at, WEEK(MONDAY)) AS week_start,
        COALESCE(c.currency_code, 'CZK') AS currency,
        ROUND(SUM(r.ad_spend), 2) AS obrat
      FROM \`${DATASET}.fact_realised_ad_agg\` r
      LEFT JOIN (
        SELECT campaign_id, currency_code FROM \`${DATASET}.dim_campaign\` WHERE is_current = true
      ) c ON r.campaign_id = c.campaign_id
      LEFT JOIN (
        SELECT team_id, team_name FROM \`${DATASET}.dim_team\` WHERE is_current = true AND team_type = 'SUPPLIER'
      ) t ON r.supplier_id = t.team_id
      WHERE r.ingressed_at >= DATE_SUB(
        DATE_TRUNC(PARSE_DATE('%Y-%m-%d', @dateTo), WEEK(MONDAY)),
        INTERVAL 14 DAY
      )
        AND r.ingressed_at <= PARSE_DATE('%Y-%m-%d', @dateTo)
      GROUP BY r.supplier_id, t.team_name, week_start, currency
    )
    SELECT * FROM last_two_weeks
    ORDER BY obrat DESC
  `;
  return q<{
    supplier_id: string;
    team_name: string;
    week_start: { value: string } | string;
    currency: string;
    obrat: number;
  }>(sql, { dateTo });
}
