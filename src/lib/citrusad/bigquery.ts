import { BigQuery } from "@google-cloud/bigquery";
import { TeamWithName, MeasureKey, MEASURES, ReportBucket, MeasureValue } from "./types";

const PROJECT_ID = "p-mkt-core-alzaads";
const LOCATION = "europe-west3";
const DATASET = "insight-platform-external-iam.alza_eu2_analytics";

function getCredentials(): object {
  const encoded = process.env.CITRUSAD_BQ_CREDENTIALS;
  if (!encoded) throw new Error("CITRUSAD_BQ_CREDENTIALS not set");
  // Strip leading 'y' if present (known encoding quirk)
  const clean = encoded.startsWith("yew") ? encoded.slice(1) : encoded;
  const decoded = Buffer.from(clean, "base64").toString("utf-8");
  return JSON.parse(decoded);
}

let _client: BigQuery | null = null;
export function getClient(): BigQuery {
  if (!_client) {
    _client = new BigQuery({
      projectId: PROJECT_ID,
      credentials: getCredentials(),
    });
  }
  return _client;
}

async function query<T>(sql: string): Promise<T[]> {
  const bq = getClient();
  const [rows] = await bq.query({ query: sql, location: LOCATION });
  return rows as T[];
}

export async function getTeams(): Promise<TeamWithName[]> {
  const rows = await query<{
    team_id: string;
    team_name: string;
  }>(`
    SELECT team_id, team_name
    FROM \`${DATASET}.dim_team\`
    WHERE is_current = true AND team_type = 'SUPPLIER' AND is_deleted = false
    ORDER BY team_name
  `);
  return rows.map((r) => ({ id: r.team_id, name: r.team_name }));
}

export interface BQWallet {
  id: string;
  name: string;
  teamId: string;
  archived: boolean;
  availableBalance: number;
  currencyCode: string;
}

export async function getWallets(teamId: string): Promise<BQWallet[]> {
  const rows = await query<{
    wallet_id: string;
    wallet_name: string;
    wallet_team_id: string;
    archived: boolean;
    available_balance: number;
    currency_code: string;
  }>(`
    SELECT wallet_id, wallet_name, wallet_team_id, archived, available_balance, currency_code
    FROM \`${DATASET}.dim_wallet\`
    WHERE is_current = true AND wallet_team_id = '${teamId}'
    ORDER BY wallet_name
  `);
  return rows.map((r) => ({
    id: r.wallet_id,
    name: r.wallet_name,
    teamId: r.wallet_team_id,
    archived: r.archived,
    availableBalance: Number(r.available_balance),
    currencyCode: r.currency_code || "CZK",
  }));
}

export interface BQCampaign {
  id: string;
  name: string;
  teamId: string;
  campaignType: string;
  activeState: string;
  walletId: string;
  currencyCode: string;
}

export async function getCampaigns(teamId: string): Promise<BQCampaign[]> {
  const rows = await query<{
    campaign_id: string;
    campaign_name: string;
    team_id: string;
    campaign_type: string;
    active_state: string;
    wallet_id: string;
    currency_code: string;
  }>(`
    SELECT campaign_id, campaign_name, team_id, campaign_type, active_state,
           COALESCE(wallet_id, '') as wallet_id,
           COALESCE(currency_code, 'CZK') as currency_code
    FROM \`${DATASET}.dim_campaign\`
    WHERE is_current = true AND team_id = '${teamId}' AND is_deleted = false
    ORDER BY campaign_name
  `);
  return rows.map((r) => ({
    id: r.campaign_id,
    name: r.campaign_name,
    teamId: r.team_id,
    campaignType: r.campaign_type,
    activeState: r.active_state,
    walletId: r.wallet_id,
    currencyCode: r.currency_code,
  }));
}

const BQ_MEASURE_MAP: Record<MeasureKey, string> = {
  Impressions: "SUM(r.impressions)",
  Clicks: "SUM(r.clicks)",
  Spend: "ROUND(SUM(r.ad_spend), 2)",
  ROAS: "ROUND(SAFE_DIVIDE(SUM(r.sales_revenue), NULLIF(SUM(r.ad_spend), 0)), 2)",
  CTR: "ROUND(SAFE_DIVIDE(SUM(r.clicks), NULLIF(SUM(r.impressions), 0)), 4)",
  CPC: "ROUND(SAFE_DIVIDE(SUM(r.ad_spend), NULLIF(SUM(r.clicks), 0)), 2)",
  CPM: "ROUND(SAFE_DIVIDE(SUM(r.ad_spend), NULLIF(SUM(r.impressions), 0)) * 1000, 2)",
  Revenue: "ROUND(SUM(r.sales_revenue), 2)",
  Conversions: "SUM(r.conversions)",
  ConversionRate:
    "ROUND(SAFE_DIVIDE(SUM(r.conversions), NULLIF(SUM(r.clicks), 0)), 4)",
  CPA: "ROUND(SAFE_DIVIDE(SUM(r.ad_spend), NULLIF(SUM(r.conversions), 0)), 2)",
  AvgPosition:
    "ROUND(SAFE_DIVIDE(SUM(r.position_sum), NULLIF(SUM(r.ads_with_position_count), 0)), 1)",
  ActiveProducts: "COUNT(DISTINCT r.product_code)",
  AdRevenue: "ROUND(SUM(r.ad_revenue), 2)",
  RevenuePerClick:
    "ROUND(SAFE_DIVIDE(SUM(r.ad_revenue), NULLIF(SUM(r.clicks), 0)), 2)",
};

export async function generateReport(opts: {
  teamId: string;
  dateFrom: string;
  dateTo: string;
  measures: MeasureKey[];
  campaignIds?: string[];
  walletId?: string;
  periodSeconds: number;
}): Promise<ReportBucket[]> {
  const {
    teamId,
    dateFrom,
    dateTo,
    measures,
    campaignIds,
    walletId,
    periodSeconds,
  } = opts;

  const selectCols = measures
    .map((k) => `${BQ_MEASURE_MAP[k]} as ${k}`)
    .join(",\n      ");

  const conditions: string[] = [
    `r.supplier_id = '${teamId}'`,
    `r.ingressed_at >= '${dateFrom}'`,
    `r.ingressed_at < '${dateTo}'`,
  ];

  if (campaignIds && campaignIds.length > 0) {
    const ids = campaignIds.map((id) => `'${id}'`).join(",");
    conditions.push(`r.campaign_id IN (${ids})`);
  }
  if (walletId) {
    conditions.push(`r.wallet_id = '${walletId}'`);
  }

  // Determine grouping
  const totalSeconds =
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 1000;
  const useMonthly = periodSeconds <= 30 * 24 * 60 * 60 && totalSeconds > periodSeconds;

  let groupBy: string;
  let orderBy: string;
  let bucketExpr: string;

  if (useMonthly) {
    bucketExpr = "DATE_TRUNC(DATE(r.ingressed_at), MONTH)";
    groupBy = "GROUP BY bucket_date";
    orderBy = "ORDER BY bucket_date";
  } else {
    bucketExpr = `DATE('${dateFrom}')`;
    groupBy = "";
    orderBy = "";
  }

  const sql = `
    SELECT
      ${bucketExpr} as bucket_date,
      ${selectCols}
    FROM \`${DATASET}.fact_realised_ad_agg\` r
    WHERE ${conditions.join("\n      AND ")}
    ${groupBy}
    ${orderBy}
  `;

  const rows = await query<Record<string, unknown>>(sql);

  return rows.map((row) => {
    const bucketDate = row.bucket_date as { value: string } | string;
    const dateStr =
      typeof bucketDate === "object" && bucketDate !== null && "value" in bucketDate
        ? bucketDate.value
        : String(bucketDate);

    const overallMeasures: MeasureValue[] = measures.map((k) => ({
      measure: MEASURES[k],
      measuredValue: Number(row[k]) || 0,
    }));

    return {
      bucketStart: dateStr + "T00:00:00Z",
      bucketLengthSeconds: periodSeconds,
      overallMeasures,
      dimensionalMeasures: [],
    };
  });
}
