// ---------------------------------------------------------------------------
// BigQuery queries for optimization — all parameterized
// ---------------------------------------------------------------------------

import { getClient } from "@/lib/citrusad/bigquery";
import type {
  FactRow,
  AttributionRow,
  CampaignConfigRow,
  CategoryCompetitionRow,
} from "./types";

const LOCATION = "europe-west3";
const DATASET = "insight-platform-external-iam.alza_eu2_analytics";

async function queryWithParams<T>(
  sql: string,
  params: Record<string, string>,
): Promise<T[]> {
  const bq = getClient();
  const types: Record<string, string> = {};
  for (const key of Object.keys(params)) {
    types[key] = "STRING";
  }
  const [rows] = await bq.query({ query: sql, params, types, location: LOCATION });
  return rows as T[];
}

// ---------------------------------------------------------------------------
// Q1+Q3 merged: fact data at (date, campaign, category)
// ingressed_at is DATE type — no wrapping needed
// ---------------------------------------------------------------------------

export async function queryFactData(
  teamId: string,
  dateFrom: string,
  dateTo: string,
  campaignIds?: string[],
): Promise<FactRow[]> {
  const campaignFilter = campaignIds && campaignIds.length > 0
    ? `AND r.campaign_id IN (${campaignIds.map((_, i) => `@cid${i}`).join(", ")})`
    : "";

  const sql = `
    SELECT
      r.ingressed_at AS d,
      r.campaign_id,
      COALESCE(r.category, '') AS category,
      COALESCE(c.currency_code, 'CZK') AS currency,
      SUM(r.impressions) AS impressions,
      SUM(r.clicks) AS clicks,
      SUM(r.unit_sales) AS units,
      ROUND(SUM(r.ad_spend), 2) AS spend,
      ROUND(SUM(r.sales_revenue), 2) AS revenue,
      COALESCE(SUM(r.position_sum), 0) AS position_sum,
      COALESCE(SUM(r.ads_with_position_count), 0) AS position_count,
      COUNT(DISTINCT r.product_code) AS product_count
    FROM \`${DATASET}.fact_realised_ad_agg\` r
    LEFT JOIN (
      SELECT campaign_id, currency_code FROM \`${DATASET}.dim_campaign\` WHERE is_current = true
    ) c ON r.campaign_id = c.campaign_id
    WHERE r.supplier_id = @teamId
      AND r.ingressed_at >= PARSE_DATE('%Y-%m-%d', @dateFrom)
      AND r.ingressed_at <= PARSE_DATE('%Y-%m-%d', @dateTo)
      ${campaignFilter}
    GROUP BY r.ingressed_at, r.campaign_id, r.category, c.currency_code
    HAVING SUM(r.impressions) > 0
  `;

  const params: Record<string, string> = { teamId, dateFrom, dateTo };
  if (campaignIds) {
    campaignIds.forEach((id, i) => { params[`cid${i}`] = id; });
  }
  return queryWithParams<FactRow>(sql, params);
}

// ---------------------------------------------------------------------------
// Q2: Enhanced attribution
// ---------------------------------------------------------------------------

export async function queryAttribution(
  teamId: string,
  dateFrom: string,
  dateTo: string,
  campaignIds?: string[],
): Promise<AttributionRow[]> {
  const campaignFilter = campaignIds && campaignIds.length > 0
    ? `AND e.campaign_id IN (${campaignIds.map((_, i) => `@cid${i}`).join(", ")})`
    : "";

  const sql = `
    SELECT
      e.ingressed_at AS d,
      SUM(e.direct_sales_value) AS direct,
      SUM(e.halo_sales_value) AS halo,
      SUM(e.view_through_sales_value) AS vt,
      SUM(e.ad_spend) AS spend
    FROM \`${DATASET}.fact_enhanced_attribution_agg\` e
    JOIN (
        SELECT campaign_id, team_id
        FROM \`${DATASET}.dim_campaign\`
        WHERE is_current = true
      ) c ON e.campaign_id = c.campaign_id
    WHERE c.team_id = @teamId
      AND e.ingressed_at >= PARSE_DATE('%Y-%m-%d', @dateFrom)
      AND e.ingressed_at <= PARSE_DATE('%Y-%m-%d', @dateTo)
      ${campaignFilter}
    GROUP BY e.ingressed_at
    ORDER BY e.ingressed_at
  `;

  const params: Record<string, string> = { teamId, dateFrom, dateTo };
  if (campaignIds) {
    campaignIds.forEach((id, i) => { params[`cid${i}`] = id; });
  }
  return queryWithParams<AttributionRow>(sql, params);
}

// ---------------------------------------------------------------------------
// Q4: Campaign config + wallet (7-day cache)
// ---------------------------------------------------------------------------

export async function queryCampaignConfigs(
  teamId: string,
): Promise<CampaignConfigRow[]> {
  const sql = `
    SELECT
      c.campaign_id,
      c.campaign_name,
      COALESCE(c.max_cost_per_click, 0) AS max_cost_per_click,
      COALESCE(c.budget, 0) AS budget,
      COALESCE(c.max_daily_spend, 0) AS max_daily_spend,
      COALESCE(c.categories, '') AS categories,
      ARRAY_TO_STRING(IFNULL(c.targeted_categories, []), ', ') AS targeted_categories,
      ARRAY_LENGTH(IFNULL(c.promoted_products, [])) AS promoted_product_count,
      c.active_state,
      COALESCE(c.currency_code, 'CZK') AS currency_code,
      COALESCE(c.wallet_id, '') AS wallet_id,
      COALESCE(w.available_balance, 0) AS available_balance,
      COALESCE(w.daily_limit, 0) AS daily_limit,
      COALESCE(w.capped_available_balance, 0) AS capped_available_balance
    FROM \`${DATASET}.dim_campaign\` c
    LEFT JOIN \`${DATASET}.dim_wallet\` w ON c.wallet_id = w.wallet_id
    WHERE c.team_id = @teamId
      AND c.is_current = true
      AND c.is_deleted = false
      AND c.active_state IN ('ACTIVE', 'PAUSED')
  `;
  return queryWithParams<CampaignConfigRow>(sql, { teamId });
}

// ---------------------------------------------------------------------------
// Q5: Category competition
// ---------------------------------------------------------------------------

export async function queryCategoryCompetition(
  teamId: string,
  dateFrom: string,
  dateTo: string,
  campaignIds?: string[],
): Promise<CategoryCompetitionRow[]> {
  // If campaign filter, scope categories to those campaigns only
  const categoryScope = campaignIds && campaignIds.length > 0
    ? `AND r.category IN (
        SELECT DISTINCT r2.category
        FROM \`${DATASET}.fact_realised_ad_agg\` r2
        WHERE r2.supplier_id = @teamId
          AND r2.ingressed_at >= PARSE_DATE('%Y-%m-%d', @dateFrom)
          AND r2.campaign_id IN (${campaignIds.map((_, i) => `@cid${i}`).join(", ")})
      )`
    : `AND r.category IN (
        SELECT DISTINCT category
        FROM \`${DATASET}.fact_realised_ad_agg\`
        WHERE supplier_id = @teamId
          AND ingressed_at >= PARSE_DATE('%Y-%m-%d', @dateFrom)
      )`;

  const sql = `
    SELECT
      r.category,
      COUNT(DISTINCT r.supplier_id) AS competitors,
      ROUND(AVG(SAFE_DIVIDE(r.ad_spend, NULLIF(r.clicks, 0))), 2) AS market_cpc,
      SUM(r.impressions) AS total_impr,
      ROUND(SAFE_DIVIDE(
        SUM(CASE WHEN r.supplier_id = @teamId THEN r.clicks ELSE 0 END),
        NULLIF(SUM(r.clicks), 0)
      ), 4) AS click_share
    FROM \`${DATASET}.fact_realised_ad_agg\` r
    WHERE r.ingressed_at >= PARSE_DATE('%Y-%m-%d', @dateFrom)
      AND r.ingressed_at <= PARSE_DATE('%Y-%m-%d', @dateTo)
      ${categoryScope}
    GROUP BY r.category
  `;

  const params: Record<string, string> = { teamId, dateFrom, dateTo };
  if (campaignIds) {
    campaignIds.forEach((id, i) => { params[`cid${i}`] = id; });
  }
  return queryWithParams<CategoryCompetitionRow>(sql, params);
}
