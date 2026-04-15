// ---------------------------------------------------------------------------
// Optimization Intelligence Layer — Types
// ---------------------------------------------------------------------------

/** Stored per-team in localStorage */
export interface TeamOptConfig {
  mode: "sales" | "brand_awareness" | "custom";
  targetRoas: number;        // e.g. 300 for sales, 200 for brand
  revenuePriority: boolean;  // true for sales
  impressionPriority: boolean; // true for brand
  customTargets?: Record<string, number>;
}

export const DEFAULT_OPT_CONFIG: TeamOptConfig = {
  mode: "sales",
  targetRoas: 300,
  revenuePriority: true,
  impressionPriority: false,
};

// ---------------------------------------------------------------------------
// Raw BQ row types (date comes as {value:string} from BigQuery)
// ---------------------------------------------------------------------------

export interface FactRow {
  d: { value: string } | string;
  campaign_id: string;
  category: string;
  currency: string;
  impressions: number;
  clicks: number;
  units: number;
  spend: number;
  revenue: number;
  position_sum: number;
  position_count: number;
  product_count: number;
}

export interface AttributionRow {
  d: { value: string } | string;
  direct: number;
  halo: number;
  vt: number;
  spend: number;
}

export interface CampaignConfigRow {
  campaign_id: string;
  campaign_name: string;
  max_cost_per_click: number;
  budget: number;
  max_daily_spend: number;
  categories: string;
  targeted_categories: string;
  promoted_product_count: number;
  active_state: string;
  currency_code: string;
  wallet_id: string;
  available_balance: number;
  daily_limit: number;
  capped_available_balance: number;
}

export interface CategoryCompetitionRow {
  category: string;
  competitors: number;
  market_cpc: number;
  total_impr: number;
  click_share: number;
}

// ---------------------------------------------------------------------------
// Aggregated / computed types
// ---------------------------------------------------------------------------

export interface DailyMetrics {
  date: string;
  impressions: number;
  clicks: number;
  units: number;
  spend: number;
  revenue: number;
}

export interface AttributionMetrics {
  date: string;
  directRevenue: number;
  haloRevenue: number;
  viewThroughRevenue: number;
  spend: number;
}

export interface CampaignCategoryPerf {
  campaignId: string;
  category: string;
  impressions: number;
  clicks: number;
  units: number;
  spend: number;
  revenue: number;
  avgPosition: number;
  productCount: number;
}

export interface CampaignConfig {
  campaignId: string;
  campaignName: string;
  maxCpc: number;
  budget: number;
  maxDailySpend: number;
  categories: string;
  targetedCategories: string;
  promotedProductCount: number;
  activeState: string;
  currency: string;
  walletId: string;
  walletBalance: number;
  walletDailyLimit: number;
  walletCappedBalance: number;
}

export interface CategoryCompetition {
  category: string;
  competitors: number;
  marketCpc: number;
  totalImpressions: number;
  clickShare: number;
}

// ---------------------------------------------------------------------------
// Recommendations & Alerts
// ---------------------------------------------------------------------------

export type RecommendationSeverity = "high" | "medium" | "low";

export type RecommendationType =
  | "category_remove"
  | "category_add"
  | "bid_increase"
  | "bid_decrease"
  | "product_remove"
  | "click_share_drop";

export interface Recommendation {
  severity: RecommendationSeverity;
  type: RecommendationType;
  campaignId: string;
  campaignName: string;
  category?: string;
  reason: string;
  impact?: string;
}

export type AlertType =
  | "wallet_low"
  | "budget_depleted"
  | "no_spend"
  | "roas_drop";

export interface Alert {
  type: AlertType;
  message: string;
  severity: RecommendationSeverity;
  details?: Record<string, number | string>;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type ScoreColor = "green" | "orange" | "red";

export interface OptimizationScore {
  score: number;
  color: ScoreColor;
  breakdown: {
    roasScore: number;
    budgetScore: number;
    trendScore: number;
    issueScore: number;
  };
}

// ---------------------------------------------------------------------------
// Per-campaign analysis
// ---------------------------------------------------------------------------

export interface CampaignSetup {
  maxCpc: number;
  budget: number;
  maxDailySpend: number;
  categories: string;
  targetedCategories: string;
  promotedProductCount: number;
  walletBalance: number;
  walletDailyLimit: number;
  walletCappedBalance: number;
}

export interface CampaignAnalysis {
  campaignId: string;
  campaignName: string;
  activeState: string;
  currency: string;
  walletId: string;
  setup: CampaignSetup;
  spend: number;
  revenue: number;
  roas: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  recommendations: Recommendation[];
}

// ---------------------------------------------------------------------------
// Period metrics (yesterday / week avg)
// ---------------------------------------------------------------------------

export interface PeriodMetrics {
  spend: number;
  revenue: number;
  roas: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  units: number;
}

// ---------------------------------------------------------------------------
// Full daily report (returned by API)
// ---------------------------------------------------------------------------

export type CountryFilter = "all" | "CZ" | "SK" | "HU";
export type CurrencyDisplay = "CZK" | "local";

export const COUNTRY_CURRENCY: Record<string, string> = {
  CZ: "CZK",
  SK: "EUR",
  HU: "HUF",
};

export const CURRENCY_COUNTRY: Record<string, string> = {
  CZK: "CZ",
  EUR: "SK",
  HUF: "HU",
};

export interface DailyReport {
  teamId: string;
  teamName: string;
  reportDate: string;
  displayCurrency: string;
  config: TeamOptConfig;
  score: OptimizationScore;
  yesterday: PeriodMetrics;
  weekAvg: PeriodMetrics;
  deltas: Record<string, number>;
  dailyTrend: DailyMetrics[];
  attribution: {
    yesterday: AttributionMetrics | null;
    weekAvg: AttributionMetrics | null;
  };
  campaigns: CampaignAnalysis[];
  recommendations: Recommendation[];
  alerts: Alert[];
  categoryCompetition: CategoryCompetition[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// AI analysis request/response
// ---------------------------------------------------------------------------

export interface AIAnalysisInput {
  teamName: string;
  config: TeamOptConfig;
  score: OptimizationScore;
  yesterday: PeriodMetrics;
  weekAvg: PeriodMetrics;
  deltas: Record<string, number>;
  recommendations: Recommendation[];
  alerts: Alert[];
  campaigns: CampaignAnalysis[];
  categoryCompetition: CategoryCompetition[];
}

export interface AIAnalysisResponse {
  summary: string;
  prioritizedActions: Array<{
    priority: number;
    action: string;
    expectedImpact: string;
    effort: "low" | "medium" | "high";
  }>;
  categoryRecommendations: string[];
  bidRecommendations: string[];
  riskAssessment: string;
}
