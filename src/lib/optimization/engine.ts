// ---------------------------------------------------------------------------
// Deterministic rules engine — scoring, recommendations, alerts
// ---------------------------------------------------------------------------

import type {
  TeamOptConfig,
  FactRow,
  AttributionRow,
  CampaignConfigRow,
  CategoryCompetitionRow,
  DailyMetrics,
  AttributionMetrics,
  CampaignCategoryPerf,
  CampaignConfig,
  CategoryCompetition,
  Recommendation,
  Alert,
  OptimizationScore,
  CampaignAnalysis,
  PeriodMetrics,
  DailyReport,
  CountryFilter,
  CurrencyDisplay,
} from "./types";
import { CURRENCY_COUNTRY } from "./types";
import type { ExchangeRates } from "./currency";
import { toCzk } from "./currency";

// ---------------------------------------------------------------------------
// Tunable thresholds (top of file, easy to adjust)
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  // Category rules
  categoryRemoveRoasRatio: 0.5,    // ROAS < 50% of target
  categoryRemoveSpendRatio: 0.1,   // spend > 10% of campaign budget
  categoryAddRoasRatio: 1.5,       // ROAS > 150% of target
  categoryAddBudgetUtil: 0.7,      // budget util < 70%
  clickShareDropThreshold: 0.3,    // >30% drop week-over-week

  // Bid rules
  bidIncreaseAvgPos: 3,            // avg position > 3
  bidIncreaseRoasRatio: 1.3,       // ROAS > 130% of target
  bidIncreaseCpcRatio: 0.8,        // effective CPC < 80% of max
  bidDecreaseRoasRatio: 0.7,       // ROAS < 70% of target
  bidDecreaseCpcRatio: 1.2,        // effective CPC > 120% of market avg

  // Wallet alerts
  walletLowDays: 5,                // warn if balance covers < 5 days

  // Score weights
  scoreRoasWeight: 40,
  scoreBudgetWeight: 20,
  scoreTrendWeight: 20,
  scoreIssueWeight: 20,

  // Budget util sweet spot
  budgetUtilLow: 0.7,
  budgetUtilHigh: 0.9,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBqDate(d: { value: string } | string): string {
  return typeof d === "object" && d !== null && "value" in d ? d.value : String(d);
}

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Safely convert BQ numeric (may be BigNumeric object) to number */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v));
  return isNaN(n) ? 0 : n;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return round2(((current - previous) / previous) * 100);
}

// ---------------------------------------------------------------------------
// Country filtering + currency conversion
// ---------------------------------------------------------------------------

function shouldIncludeRow(currency: string, country: CountryFilter): boolean {
  if (country === "all") return true;
  return CURRENCY_COUNTRY[currency] === country;
}

function convertMoney(
  amount: number,
  rowCurrency: string,
  displayCurrency: CurrencyDisplay,
  rates: ExchangeRates | null,
): number {
  if (displayCurrency === "local" || !rates) return amount;
  // displayCurrency === "CZK" — convert everything to CZK
  return toCzk(amount, rowCurrency, rates);
}

// ---------------------------------------------------------------------------
// Data aggregation from merged fact rows
// ---------------------------------------------------------------------------

export function aggregateDailyMetrics(
  rows: FactRow[],
  fromDate: string,
  country: CountryFilter = "all",
  displayCurrency: CurrencyDisplay = "CZK",
  rates: ExchangeRates | null = null,
): DailyMetrics[] {
  const byDate = new Map<string, DailyMetrics>();
  for (const r of rows) {
    const cur = r.currency || "CZK";
    if (!shouldIncludeRow(cur, country)) continue;
    const d = parseBqDate(r.d);
    if (d < fromDate) continue;
    const spend = convertMoney(num(r.spend), cur, displayCurrency, rates);
    const revenue = convertMoney(num(r.revenue), cur, displayCurrency, rates);
    const existing = byDate.get(d);
    if (existing) {
      existing.impressions += num(r.impressions);
      existing.clicks += num(r.clicks);
      existing.units += num(r.units);
      existing.spend += spend;
      existing.revenue += revenue;
    } else {
      byDate.set(d, {
        date: d,
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        units: num(r.units),
        spend,
        revenue,
      });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregateCampaignCategory(
  rows: FactRow[],
  country: CountryFilter = "all",
  displayCurrency: CurrencyDisplay = "CZK",
  rates: ExchangeRates | null = null,
): CampaignCategoryPerf[] {
  const key = (r: FactRow) => `${r.campaign_id}::${r.category}`;
  const map = new Map<string, {
    campaignId: string; category: string;
    impressions: number; clicks: number; units: number;
    spend: number; revenue: number;
    posSum: number; posCount: number; maxProducts: number;
  }>();

  for (const r of rows) {
    const cur = r.currency || "CZK";
    if (!shouldIncludeRow(cur, country)) continue;
    const k = key(r);
    const spend = convertMoney(num(r.spend), cur, displayCurrency, rates);
    const revenue = convertMoney(num(r.revenue), cur, displayCurrency, rates);
    const existing = map.get(k);
    if (existing) {
      existing.impressions += num(r.impressions);
      existing.clicks += num(r.clicks);
      existing.units += num(r.units);
      existing.spend += spend;
      existing.revenue += revenue;
      existing.posSum += num(r.position_sum);
      existing.posCount += num(r.position_count);
      existing.maxProducts = Math.max(existing.maxProducts, num(r.product_count));
    } else {
      map.set(k, {
        campaignId: r.campaign_id,
        category: r.category,
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        units: num(r.units),
        spend,
        revenue,
        posSum: num(r.position_sum),
        posCount: num(r.position_count),
        maxProducts: num(r.product_count),
      });
    }
  }

  return Array.from(map.values()).map((v) => ({
    campaignId: v.campaignId,
    category: v.category,
    impressions: v.impressions,
    clicks: v.clicks,
    units: v.units,
    spend: round2(v.spend),
    revenue: round2(v.revenue),
    avgPosition: round2(safeDivide(v.posSum, v.posCount)),
    productCount: v.maxProducts,
  }));
}

export function aggregateAttribution(rows: AttributionRow[]): AttributionMetrics[] {
  return rows.map((r) => ({
    date: parseBqDate(r.d),
    directRevenue: num(r.direct),
    haloRevenue: num(r.halo),
    viewThroughRevenue: num(r.vt),
    spend: num(r.spend),
  }));
}

export function mapCampaignConfigs(rows: CampaignConfigRow[]): CampaignConfig[] {
  return rows.map((r) => ({
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    maxCpc: num(r.max_cost_per_click),
    budget: num(r.budget),
    maxDailySpend: num(r.max_daily_spend),
    categories: r.categories,
    targetedCategories: r.targeted_categories,
    promotedProductCount: num(r.promoted_product_count),
    activeState: r.active_state,
    currency: r.currency_code || "CZK",
    walletId: r.wallet_id,
    walletBalance: num(r.available_balance),
    walletDailyLimit: num(r.daily_limit),
    walletCappedBalance: num(r.capped_available_balance),
  }));
}

export function mapCategoryCompetition(
  rows: CategoryCompetitionRow[],
): CategoryCompetition[] {
  return rows.map((r) => ({
    category: r.category,
    competitors: num(r.competitors),
    marketCpc: num(r.market_cpc),
    totalImpressions: num(r.total_impr),
    clickShare: num(r.click_share),
  }));
}

// ---------------------------------------------------------------------------
// Period metrics computation
// ---------------------------------------------------------------------------

export function computePeriodMetrics(days: DailyMetrics[]): PeriodMetrics {
  if (days.length === 0) {
    return { spend: 0, revenue: 0, roas: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, units: 0 };
  }
  const totals = days.reduce(
    (acc, d) => ({
      spend: acc.spend + d.spend,
      revenue: acc.revenue + d.revenue,
      impressions: acc.impressions + d.impressions,
      clicks: acc.clicks + d.clicks,
      units: acc.units + d.units,
    }),
    { spend: 0, revenue: 0, impressions: 0, clicks: 0, units: 0 },
  );
  const n = days.length;
  return {
    spend: round2(totals.spend / n),
    revenue: round2(totals.revenue / n),
    roas: round2(safeDivide(totals.revenue, totals.spend)),
    impressions: Math.round(totals.impressions / n),
    clicks: Math.round(totals.clicks / n),
    ctr: round4(safeDivide(totals.clicks, totals.impressions)),
    cpc: round2(safeDivide(totals.spend, totals.clicks)),
    units: Math.round(totals.units / n),
  };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export function computeAlerts(
  configs: CampaignConfig[],
  yesterdayMetrics: PeriodMetrics,
  weekAvg: PeriodMetrics,
): Alert[] {
  const alerts: Alert[] = [];

  // Wallet low
  const activeConfigs = configs.filter((c) => c.activeState === "ACTIVE");
  const seenWallets = new Set<string>();
  for (const c of activeConfigs) {
    if (!c.walletId || seenWallets.has(c.walletId)) continue;
    seenWallets.add(c.walletId);
    if (c.walletBalance > 0 && yesterdayMetrics.spend > 0) {
      const daysRemaining = c.walletBalance / yesterdayMetrics.spend;
      if (daysRemaining < THRESHOLDS.walletLowDays) {
        alerts.push({
          type: "wallet_low",
          severity: daysRemaining < 2 ? "high" : "medium",
          message: `Peněženka vydrží ~${Math.round(daysRemaining)} dní při aktuálním tempu.`,
          details: { daysRemaining: Math.round(daysRemaining), balance: c.walletBalance },
        });
      }
    }
  }

  // No spend yesterday
  if (yesterdayMetrics.spend === 0 && weekAvg.spend > 0) {
    alerts.push({
      type: "no_spend",
      severity: "high",
      message: "Včera nebyl žádný spend. Zkontrolujte stav kampaní a peněženek.",
    });
  }

  // ROAS significant drop
  if (weekAvg.roas > 0 && yesterdayMetrics.roas > 0) {
    const roasDrop = pctChange(yesterdayMetrics.roas, weekAvg.roas);
    if (roasDrop < -30) {
      alerts.push({
        type: "roas_drop",
        severity: "high",
        message: `ROAS klesl o ${Math.abs(roasDrop)}% oproti 7dennímu průměru.`,
        details: { yesterday: yesterdayMetrics.roas, weekAvg: weekAvg.roas },
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Category rules
// ---------------------------------------------------------------------------

function applyCategoryRules(
  catPerfs: CampaignCategoryPerf[],
  configs: CampaignConfig[],
  competition: CategoryCompetition[],
  config: TeamOptConfig,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const configMap = new Map(configs.map((c) => [c.campaignId, c]));
  const compMap = new Map(competition.map((c) => [c.category, c]));

  // Group by campaign
  const byCampaign = new Map<string, CampaignCategoryPerf[]>();
  for (const cp of catPerfs) {
    const arr = byCampaign.get(cp.campaignId) ?? [];
    arr.push(cp);
    byCampaign.set(cp.campaignId, arr);
  }

  for (const [campaignId, cats] of byCampaign) {
    const campaignConfig = configMap.get(campaignId);
    if (!campaignConfig) continue;

    const totalSpend = cats.reduce((s, c) => s + c.spend, 0);
    const totalRevenue = cats.reduce((s, c) => s + c.revenue, 0);
    const campaignRoas = safeDivide(totalRevenue, totalSpend);

    for (const cat of cats) {
      const catRoas = safeDivide(cat.revenue, cat.spend);
      const catSpendShare = safeDivide(cat.spend, totalSpend);

      // REMOVE category
      if (
        catRoas < config.targetRoas * THRESHOLDS.categoryRemoveRoasRatio / 100 &&
        catSpendShare > THRESHOLDS.categoryRemoveSpendRatio
      ) {
        recs.push({
          severity: "high",
          type: "category_remove",
          campaignId,
          campaignName: campaignConfig.campaignName,
          category: cat.category,
          reason: `ROAS ${round2(catRoas)}x je pod 50% cíle (${config.targetRoas / 100}x) a spotřebovává ${round2(catSpendShare * 100)}% rozpočtu kampaně.`,
        });
      }

      // Click share drop alert
      const comp = compMap.get(cat.category);
      if (comp && comp.clickShare > 0 && catRoas > config.targetRoas / 100) {
        // Only flag high-ROAS categories where we're losing share
        // (Actual WoW comparison would require prior week data; use clickShare < expected as proxy)
      }
    }

    // ADD category: campaign performing well but underutilizing budget
    const budgetUtil = safeDivide(totalSpend, campaignConfig.budget || 1);
    if (
      campaignRoas > config.targetRoas * THRESHOLDS.categoryAddRoasRatio / 100 &&
      budgetUtil < THRESHOLDS.categoryAddBudgetUtil &&
      campaignConfig.activeState === "ACTIVE"
    ) {
      recs.push({
        severity: "low",
        type: "category_add",
        campaignId,
        campaignName: campaignConfig.campaignName,
        reason: `ROAS ${round2(campaignRoas)}x převyšuje cíl a rozpočet je využit jen na ${round2(budgetUtil * 100)}%. Zvažte přidání dalších kategorií.`,
      });
    }
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Bid rules
// ---------------------------------------------------------------------------

function applyBidRules(
  catPerfs: CampaignCategoryPerf[],
  configs: CampaignConfig[],
  competition: CategoryCompetition[],
  targetRoas: number,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const configMap = new Map(configs.map((c) => [c.campaignId, c]));
  const compMap = new Map(competition.map((c) => [c.category, c]));

  // Group by campaign
  const byCampaign = new Map<string, CampaignCategoryPerf[]>();
  for (const cp of catPerfs) {
    const arr = byCampaign.get(cp.campaignId) ?? [];
    arr.push(cp);
    byCampaign.set(cp.campaignId, arr);
  }

  for (const [campaignId, cats] of byCampaign) {
    const campaignConfig = configMap.get(campaignId);
    if (!campaignConfig || campaignConfig.activeState !== "ACTIVE") continue;

    const totalSpend = cats.reduce((s, c) => s + c.spend, 0);
    const totalClicks = cats.reduce((s, c) => s + c.clicks, 0);
    const totalRevenue = cats.reduce((s, c) => s + c.revenue, 0);
    const campaignRoas = safeDivide(totalRevenue, totalSpend);
    const effectiveCpc = safeDivide(totalSpend, totalClicks);

    // Weighted avg position
    const totalImpr = cats.reduce((s, c) => s + c.impressions, 0);
    const weightedPos = cats.reduce((s, c) => s + c.avgPosition * c.impressions, 0);
    const avgPos = safeDivide(weightedPos, totalImpr);

    // Market CPC (avg across campaign's categories)
    let marketCpcSum = 0;
    let marketCpcCount = 0;
    for (const cat of cats) {
      const comp = compMap.get(cat.category);
      if (comp && comp.marketCpc > 0) {
        marketCpcSum += comp.marketCpc;
        marketCpcCount++;
      }
    }
    const avgMarketCpc = safeDivide(marketCpcSum, marketCpcCount);

    // INCREASE bid
    if (
      avgPos > THRESHOLDS.bidIncreaseAvgPos &&
      campaignRoas > targetRoas * THRESHOLDS.bidIncreaseRoasRatio / 100 &&
      campaignConfig.maxCpc > 0 &&
      effectiveCpc < campaignConfig.maxCpc * THRESHOLDS.bidIncreaseCpcRatio
    ) {
      recs.push({
        severity: "medium",
        type: "bid_increase",
        campaignId,
        campaignName: campaignConfig.campaignName,
        reason: `Průměrná pozice ${round2(avgPos)} při ROAS ${round2(campaignRoas)}x a efektivní CPC ${round2(effectiveCpc)} Kč (max ${round2(campaignConfig.maxCpc)} Kč). Zvýšení bidu může zlepšit pozici a objem.`,
      });
    }

    // DECREASE bid
    if (
      campaignRoas < targetRoas * THRESHOLDS.bidDecreaseRoasRatio / 100 &&
      avgMarketCpc > 0 &&
      effectiveCpc > avgMarketCpc * THRESHOLDS.bidDecreaseCpcRatio
    ) {
      recs.push({
        severity: "high",
        type: "bid_decrease",
        campaignId,
        campaignName: campaignConfig.campaignName,
        reason: `ROAS ${round2(campaignRoas)}x je pod 70% cíle a CPC ${round2(effectiveCpc)} Kč je nad tržním průměrem (${round2(avgMarketCpc)} Kč). Snížení bidu sníží náklady.`,
      });
    }
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function computeScore(
  yesterdayMetrics: PeriodMetrics,
  weekAvg: PeriodMetrics,
  config: TeamOptConfig,
  urgentCount: number,
): OptimizationScore {
  const T = THRESHOLDS;

  // 1. ROAS target met (40 points, proportional)
  const roasRatio = Math.min(safeDivide(yesterdayMetrics.roas, config.targetRoas / 100), 1);
  const roasScore = round2(roasRatio * T.scoreRoasWeight);

  // 2. Budget utilization (20 points, sweet spot 70-90%)
  // Use spend relative to week average as proxy for budget util
  const spendRatio = weekAvg.spend > 0 ? yesterdayMetrics.spend / weekAvg.spend : 1;
  let budgetScore: number;
  if (spendRatio >= T.budgetUtilLow && spendRatio <= T.budgetUtilHigh) {
    budgetScore = T.scoreBudgetWeight; // full marks
  } else if (spendRatio < T.budgetUtilLow) {
    budgetScore = round2((spendRatio / T.budgetUtilLow) * T.scoreBudgetWeight);
  } else {
    // Over 90% — mild penalty
    budgetScore = round2(Math.max(T.scoreBudgetWeight - (spendRatio - T.budgetUtilHigh) * 20, T.scoreBudgetWeight * 0.5));
  }

  // 3. Trend positive (20 points, yesterday vs 7-day avg)
  let trendScore = T.scoreTrendWeight / 2; // neutral baseline
  if (weekAvg.roas > 0) {
    const roasTrend = (yesterdayMetrics.roas - weekAvg.roas) / weekAvg.roas;
    trendScore = round2(Math.max(0, Math.min(T.scoreTrendWeight, (T.scoreTrendWeight / 2) + roasTrend * T.scoreTrendWeight)));
  }

  // 4. No urgent issues (20 points, deduct per urgent recommendation)
  const issueScore = round2(Math.max(0, T.scoreIssueWeight - urgentCount * 5));

  const totalScore = Math.round(roasScore + budgetScore + trendScore + issueScore);
  const color = totalScore >= 70 ? "green" : totalScore >= 40 ? "orange" : "red";

  return {
    score: totalScore,
    color,
    breakdown: { roasScore, budgetScore, trendScore, issueScore },
  };
}

// ---------------------------------------------------------------------------
// Campaign-level analysis
// ---------------------------------------------------------------------------

function buildCampaignAnalyses(
  catPerfs: CampaignCategoryPerf[],
  configs: CampaignConfig[],
  allRecs: Recommendation[],
  country: CountryFilter = "all",
  campaignIds?: string[],
): CampaignAnalysis[] {
  // Filter configs by country, then by explicit campaign selection
  let filteredConfigs = country === "all"
    ? configs
    : configs.filter((c) => CURRENCY_COUNTRY[c.currency] === country);
  if (campaignIds && campaignIds.length > 0) {
    const idSet = new Set(campaignIds);
    filteredConfigs = filteredConfigs.filter((c) => idSet.has(c.campaignId));
  }
  const configMap = new Map(filteredConfigs.map((c) => [c.campaignId, c]));

  // Aggregate catPerfs per campaign (only for filtered campaigns)
  const byCampaign = new Map<string, { spend: number; revenue: number; impressions: number; clicks: number }>();
  for (const cp of catPerfs) {
    if (!configMap.has(cp.campaignId)) continue;
    const existing = byCampaign.get(cp.campaignId);
    if (existing) {
      existing.spend += cp.spend;
      existing.revenue += cp.revenue;
      existing.impressions += cp.impressions;
      existing.clicks += cp.clicks;
    } else {
      byCampaign.set(cp.campaignId, {
        spend: cp.spend,
        revenue: cp.revenue,
        impressions: cp.impressions,
        clicks: cp.clicks,
      });
    }
  }

  // Build recs map
  const recsByCampaign = new Map<string, Recommendation[]>();
  for (const r of allRecs) {
    const arr = recsByCampaign.get(r.campaignId) ?? [];
    arr.push(r);
    recsByCampaign.set(r.campaignId, arr);
  }

  const analyses: CampaignAnalysis[] = [];
  for (const cfg of filteredConfigs) {
    const perf = byCampaign.get(cfg.campaignId);
    const spend = perf?.spend ?? 0;
    const revenue = perf?.revenue ?? 0;
    const impressions = perf?.impressions ?? 0;
    const clicks = perf?.clicks ?? 0;

    analyses.push({
      campaignId: cfg.campaignId,
      campaignName: cfg.campaignName,
      activeState: cfg.activeState,
      currency: cfg.currency,
      walletId: cfg.walletId,
      setup: {
        maxCpc: cfg.maxCpc,
        budget: cfg.budget,
        maxDailySpend: cfg.maxDailySpend,
        categories: cfg.categories,
        targetedCategories: cfg.targetedCategories,
        promotedProductCount: cfg.promotedProductCount,
        walletBalance: cfg.walletBalance,
        walletDailyLimit: cfg.walletDailyLimit,
        walletCappedBalance: cfg.walletCappedBalance,
      },
      spend: round2(spend),
      revenue: round2(revenue),
      roas: round2(safeDivide(revenue, spend)),
      impressions,
      clicks,
      ctr: round4(safeDivide(clicks, impressions)),
      cpc: round2(safeDivide(spend, clicks)),
      recommendations: recsByCampaign.get(cfg.campaignId) ?? [],
    });
  }

  return analyses.sort((a, b) => b.spend - a.spend);
}

// ---------------------------------------------------------------------------
// Main: build full daily report
// ---------------------------------------------------------------------------

export function buildDailyReport(
  teamId: string,
  teamName: string,
  dateTo: string,
  config: TeamOptConfig,
  factRows: FactRow[],
  attrRows: AttributionRow[],
  configRows: CampaignConfigRow[],
  competitionRows: CategoryCompetitionRow[],
  country: CountryFilter = "all",
  displayCurrency: CurrencyDisplay = "CZK",
  rates: ExchangeRates | null = null,
  campaignIds?: string[],
): DailyReport {
  // All metrics across the full queried range
  const allDailyMetrics = aggregateDailyMetrics(factRows, "1900-01-01", country, displayCurrency, rates);
  const catPerfs = aggregateCampaignCategory(factRows, country, displayCurrency, rates);
  const attrMetrics = aggregateAttribution(attrRows);
  const configs = mapCampaignConfigs(configRows);
  const competition = mapCategoryCompetition(competitionRows);

  // "Last day" = dateTo (most recent day in range)
  // "Period avg" = average across all days in the queried range
  const lastDayMetrics = allDailyMetrics.filter((d) => d.date === dateTo);
  const lastDayPeriod = computePeriodMetrics(lastDayMetrics);
  const periodAvg = computePeriodMetrics(allDailyMetrics);

  // Deltas (percentage change last day vs period avg)
  const deltas: Record<string, number> = {
    spend: pctChange(lastDayPeriod.spend, periodAvg.spend),
    revenue: pctChange(lastDayPeriod.revenue, periodAvg.revenue),
    roas: pctChange(lastDayPeriod.roas, periodAvg.roas),
    impressions: pctChange(lastDayPeriod.impressions, periodAvg.impressions),
    clicks: pctChange(lastDayPeriod.clicks, periodAvg.clicks),
    ctr: pctChange(lastDayPeriod.ctr, periodAvg.ctr),
    cpc: pctChange(lastDayPeriod.cpc, periodAvg.cpc),
    units: pctChange(lastDayPeriod.units, periodAvg.units),
  };

  // Attribution
  const attrLastDay = attrMetrics.find((a) => a.date === dateTo) ?? null;
  const attrPeriodAvg = attrMetrics.length > 0
    ? {
        date: "avg",
        directRevenue: round2(attrMetrics.reduce((s, a) => s + a.directRevenue, 0) / attrMetrics.length),
        haloRevenue: round2(attrMetrics.reduce((s, a) => s + a.haloRevenue, 0) / attrMetrics.length),
        viewThroughRevenue: round2(attrMetrics.reduce((s, a) => s + a.viewThroughRevenue, 0) / attrMetrics.length),
        spend: round2(attrMetrics.reduce((s, a) => s + a.spend, 0) / attrMetrics.length),
      }
    : null;

  // Rules
  const categoryRecs = applyCategoryRules(catPerfs, configs, competition, config);
  const bidRecs = applyBidRules(catPerfs, configs, competition, config.targetRoas);
  const allRecs = [...categoryRecs, ...bidRecs];
  const alerts = computeAlerts(configs, lastDayPeriod, periodAvg);

  // Score
  const urgentCount = allRecs.filter((r) => r.severity === "high").length + alerts.filter((a) => a.severity === "high").length;
  const score = computeScore(lastDayPeriod, periodAvg, config, urgentCount);

  // Campaign analyses
  const campaigns = buildCampaignAnalyses(catPerfs, configs, allRecs, country, campaignIds);

  // Determine display currency label
  const currencyLabel = displayCurrency === "CZK" ? "CZK"
    : country === "CZ" ? "CZK"
    : country === "SK" ? "EUR"
    : country === "HU" ? "HUF"
    : "CZK";

  return {
    teamId,
    teamName,
    reportDate: dateTo,
    displayCurrency: currencyLabel,
    config,
    score,
    yesterday: lastDayPeriod,
    weekAvg: periodAvg,
    deltas,
    dailyTrend: allDailyMetrics,
    attribution: {
      yesterday: attrLastDay,
      weekAvg: attrPeriodAvg,
    },
    campaigns,
    recommendations: allRecs.sort((a, b) => {
      const sevOrder = { high: 0, medium: 1, low: 2 };
      return sevOrder[a.severity] - sevOrder[b.severity];
    }),
    alerts,
    categoryCompetition: competition,
    generatedAt: new Date().toISOString(),
  };
}
