import { describe, it, expect } from "vitest";
import {
  aggregateDailyMetrics,
  aggregateCampaignCategory,
  aggregateAttribution,
  mapCampaignConfigs,
  mapCategoryCompetition,
  computePeriodMetrics,
  computeAlerts,
  computeScore,
  buildDailyReport,
  THRESHOLDS,
} from "../engine";
import type {
  FactRow,
  AttributionRow,
  CampaignConfigRow,
  CategoryCompetitionRow,
  TeamOptConfig,
  PeriodMetrics,
  CampaignConfig,
} from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFactRow(overrides: Partial<FactRow> = {}): FactRow {
  return {
    d: { value: "2026-04-14" },
    campaign_id: "camp-1",
    category: "Notebooky",
    impressions: 1000,
    clicks: 50,
    units: 10,
    spend: 500,
    revenue: 2000,
    position_sum: 100,
    position_count: 50,
    product_count: 5,
    ...overrides,
  };
}

function makeCampaignConfigRow(overrides: Partial<CampaignConfigRow> = {}): CampaignConfigRow {
  return {
    campaign_id: "camp-1",
    campaign_name: "Test Campaign",
    max_cost_per_click: 10,
    budget: 10000,
    max_daily_spend: 500,
    categories: "Notebooky",
    targeted_categories: "Notebooky",
    promoted_product_count: 0,
    active_state: "ACTIVE",
    wallet_id: "wallet-1",
    available_balance: 50000,
    daily_limit: 5000,
    capped_available_balance: 50000,
    ...overrides,
  };
}

function makeCompetitionRow(overrides: Partial<CategoryCompetitionRow> = {}): CategoryCompetitionRow {
  return {
    category: "Notebooky",
    competitors: 5,
    market_cpc: 8,
    total_impr: 50000,
    click_share: 0.15,
    ...overrides,
  };
}

const defaultConfig: TeamOptConfig = {
  mode: "sales",
  targetRoas: 300,
  revenuePriority: true,
  impressionPriority: false,
};

// ---------------------------------------------------------------------------
// aggregateDailyMetrics
// ---------------------------------------------------------------------------

describe("aggregateDailyMetrics", () => {
  it("aggregates rows by date and filters by fromDate", () => {
    const rows: FactRow[] = [
      makeFactRow({ d: { value: "2026-04-10" }, impressions: 100, spend: 50 }),
      makeFactRow({ d: { value: "2026-04-14" }, impressions: 200, spend: 100 }),
      makeFactRow({ d: { value: "2026-04-14" }, campaign_id: "camp-2", impressions: 300, spend: 150 }),
    ];
    const result = aggregateDailyMetrics(rows, "2026-04-12");
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-04-14");
    expect(result[0].impressions).toBe(500);
    expect(result[0].spend).toBe(250);
  });

  it("returns empty array for no matching rows", () => {
    const rows = [makeFactRow({ d: { value: "2026-04-01" } })];
    expect(aggregateDailyMetrics(rows, "2026-04-10")).toHaveLength(0);
  });

  it("handles string date format", () => {
    const rows = [makeFactRow({ d: "2026-04-14" as unknown as { value: string } })];
    const result = aggregateDailyMetrics(rows, "2026-04-10");
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-04-14");
  });

  it("sorts by date ascending", () => {
    const rows = [
      makeFactRow({ d: { value: "2026-04-14" } }),
      makeFactRow({ d: { value: "2026-04-12" } }),
      makeFactRow({ d: { value: "2026-04-13" } }),
    ];
    const result = aggregateDailyMetrics(rows, "2026-04-01");
    expect(result.map((r) => r.date)).toEqual(["2026-04-12", "2026-04-13", "2026-04-14"]);
  });
});

// ---------------------------------------------------------------------------
// aggregateCampaignCategory
// ---------------------------------------------------------------------------

describe("aggregateCampaignCategory", () => {
  it("aggregates across dates for same campaign+category", () => {
    const rows: FactRow[] = [
      makeFactRow({ d: { value: "2026-04-13" }, spend: 100, revenue: 400 }),
      makeFactRow({ d: { value: "2026-04-14" }, spend: 200, revenue: 600 }),
    ];
    const result = aggregateCampaignCategory(rows);
    expect(result).toHaveLength(1);
    expect(result[0].spend).toBe(300);
    expect(result[0].revenue).toBe(1000);
  });

  it("keeps different campaigns separate", () => {
    const rows: FactRow[] = [
      makeFactRow({ campaign_id: "A", category: "X", spend: 100 }),
      makeFactRow({ campaign_id: "B", category: "X", spend: 200 }),
    ];
    const result = aggregateCampaignCategory(rows);
    expect(result).toHaveLength(2);
  });

  it("keeps different categories separate", () => {
    const rows: FactRow[] = [
      makeFactRow({ category: "X", spend: 100 }),
      makeFactRow({ category: "Y", spend: 200 }),
    ];
    const result = aggregateCampaignCategory(rows);
    expect(result).toHaveLength(2);
  });

  it("computes avgPosition from position_sum and position_count", () => {
    const rows = [makeFactRow({ position_sum: 200, position_count: 100 })];
    const result = aggregateCampaignCategory(rows);
    expect(result[0].avgPosition).toBe(2);
  });

  it("handles zero position_count", () => {
    const rows = [makeFactRow({ position_sum: 0, position_count: 0 })];
    const result = aggregateCampaignCategory(rows);
    expect(result[0].avgPosition).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computePeriodMetrics
// ---------------------------------------------------------------------------

describe("computePeriodMetrics", () => {
  it("returns zeros for empty input", () => {
    const result = computePeriodMetrics([]);
    expect(result.spend).toBe(0);
    expect(result.roas).toBe(0);
    expect(result.ctr).toBe(0);
  });

  it("computes daily averages for multiple days", () => {
    const days = [
      { date: "2026-04-13", impressions: 1000, clicks: 100, units: 10, spend: 500, revenue: 1500 },
      { date: "2026-04-14", impressions: 2000, clicks: 200, units: 20, spend: 1000, revenue: 3000 },
    ];
    const result = computePeriodMetrics(days);
    expect(result.spend).toBe(750); // avg
    expect(result.impressions).toBe(1500); // avg
    // ROAS is total revenue / total spend = 4500/1500 = 3
    expect(result.roas).toBe(3);
  });

  it("handles zero spend (no division by zero)", () => {
    const days = [
      { date: "2026-04-14", impressions: 100, clicks: 10, units: 0, spend: 0, revenue: 0 },
    ];
    const result = computePeriodMetrics(days);
    expect(result.roas).toBe(0);
    expect(result.cpc).toBe(0);
  });

  it("handles zero impressions", () => {
    const days = [
      { date: "2026-04-14", impressions: 0, clicks: 0, units: 0, spend: 100, revenue: 0 },
    ];
    const result = computePeriodMetrics(days);
    expect(result.ctr).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeAlerts
// ---------------------------------------------------------------------------

describe("computeAlerts", () => {
  const baseYesterday: PeriodMetrics = {
    spend: 1000, revenue: 3000, roas: 3, impressions: 10000, clicks: 500, ctr: 0.05, cpc: 2, units: 50,
  };
  const baseWeekAvg: PeriodMetrics = {
    spend: 1000, revenue: 3000, roas: 3, impressions: 10000, clicks: 500, ctr: 0.05, cpc: 2, units: 50,
  };

  it("generates wallet_low alert when balance is low", () => {
    const configs: CampaignConfig[] = [{
      campaignId: "c1", campaignName: "C1", maxCpc: 10, budget: 10000,
      maxDailySpend: 500, categories: "", targetedCategories: "", promotedProductCount: 0,
      activeState: "ACTIVE", walletId: "w1",
      walletBalance: 2000, walletDailyLimit: 5000, walletCappedBalance: 2000,
    }];
    const alerts = computeAlerts(configs, baseYesterday, baseWeekAvg);
    const walletAlerts = alerts.filter((a) => a.type === "wallet_low");
    expect(walletAlerts).toHaveLength(1);
    expect(walletAlerts[0].severity).toBe("medium"); // 2000/1000 = 2 days, < 5 but not < 2
  });

  it("does NOT generate wallet alert when balance is sufficient", () => {
    const configs: CampaignConfig[] = [{
      campaignId: "c1", campaignName: "C1", maxCpc: 10, budget: 10000,
      maxDailySpend: 500, categories: "", targetedCategories: "", promotedProductCount: 0,
      activeState: "ACTIVE", walletId: "w1",
      walletBalance: 100000, walletDailyLimit: 5000, walletCappedBalance: 100000,
    }];
    const alerts = computeAlerts(configs, baseYesterday, baseWeekAvg);
    expect(alerts.filter((a) => a.type === "wallet_low")).toHaveLength(0);
  });

  it("generates no_spend alert", () => {
    const yesterday: PeriodMetrics = { ...baseYesterday, spend: 0 };
    const alerts = computeAlerts([], yesterday, baseWeekAvg);
    expect(alerts.some((a) => a.type === "no_spend")).toBe(true);
  });

  it("generates roas_drop alert on >30% drop", () => {
    const yesterday: PeriodMetrics = { ...baseYesterday, roas: 1.5 };
    const weekAvg: PeriodMetrics = { ...baseWeekAvg, roas: 3 };
    const alerts = computeAlerts([], yesterday, weekAvg);
    expect(alerts.some((a) => a.type === "roas_drop")).toBe(true);
  });

  it("does NOT alert on minor roas drop", () => {
    const yesterday: PeriodMetrics = { ...baseYesterday, roas: 2.5 };
    const weekAvg: PeriodMetrics = { ...baseWeekAvg, roas: 3 };
    const alerts = computeAlerts([], yesterday, weekAvg);
    expect(alerts.some((a) => a.type === "roas_drop")).toBe(false);
  });

  it("skips paused campaigns for wallet alerts", () => {
    const configs: CampaignConfig[] = [{
      campaignId: "c1", campaignName: "C1", maxCpc: 10, budget: 10000,
      maxDailySpend: 500, categories: "", targetedCategories: "", promotedProductCount: 0,
      activeState: "PAUSED", walletId: "w1",
      walletBalance: 500, walletDailyLimit: 5000, walletCappedBalance: 500,
    }];
    const alerts = computeAlerts(configs, baseYesterday, baseWeekAvg);
    expect(alerts.filter((a) => a.type === "wallet_low")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeScore
// ---------------------------------------------------------------------------

describe("computeScore", () => {
  const baseMetrics: PeriodMetrics = {
    spend: 1000, revenue: 3000, roas: 3, impressions: 10000, clicks: 500, ctr: 0.05, cpc: 2, units: 50,
  };

  it("returns green for high-performing campaign", () => {
    const score = computeScore(baseMetrics, baseMetrics, defaultConfig, 0);
    expect(score.color).toBe("green");
    expect(score.score).toBeGreaterThanOrEqual(70);
  });

  it("returns red for zero performance", () => {
    const zero: PeriodMetrics = { spend: 0, revenue: 0, roas: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, units: 0 };
    const score = computeScore(zero, baseMetrics, defaultConfig, 5);
    expect(score.color).toBe("red");
    expect(score.score).toBeLessThan(40);
  });

  it("deducts points for urgent issues", () => {
    const noIssues = computeScore(baseMetrics, baseMetrics, defaultConfig, 0);
    const withIssues = computeScore(baseMetrics, baseMetrics, defaultConfig, 3);
    expect(withIssues.score).toBeLessThan(noIssues.score);
  });

  it("gives full budget score in sweet spot", () => {
    // Yesterday spend = 80% of week avg (within 70-90%)
    const yesterday = { ...baseMetrics, spend: 800 };
    const weekAvg = { ...baseMetrics, spend: 1000 };
    const score = computeScore(yesterday, weekAvg, defaultConfig, 0);
    expect(score.breakdown.budgetScore).toBe(THRESHOLDS.scoreBudgetWeight);
  });

  it("penalizes ROAS below target", () => {
    const low = { ...baseMetrics, roas: 1 }; // target is 3 (300/100)
    const score = computeScore(low, baseMetrics, defaultConfig, 0);
    expect(score.breakdown.roasScore).toBeLessThan(THRESHOLDS.scoreRoasWeight);
  });

  it("caps ROAS score at max when exceeding target", () => {
    const high = { ...baseMetrics, roas: 10 };
    const score = computeScore(high, baseMetrics, defaultConfig, 0);
    expect(score.breakdown.roasScore).toBe(THRESHOLDS.scoreRoasWeight);
  });

  it("returns orange for mediocre performance", () => {
    const mediocre = { ...baseMetrics, roas: 1.5 }; // 50% of target
    const score = computeScore(mediocre, baseMetrics, defaultConfig, 2);
    expect(score.color).toBe("orange");
  });
});

// ---------------------------------------------------------------------------
// buildDailyReport
// ---------------------------------------------------------------------------

describe("buildDailyReport", () => {
  it("builds a complete report from raw data", () => {
    const factRows: FactRow[] = [
      makeFactRow({ d: { value: "2026-04-08" }, spend: 100, revenue: 400 }),
      makeFactRow({ d: { value: "2026-04-09" }, spend: 120, revenue: 450 }),
      makeFactRow({ d: { value: "2026-04-10" }, spend: 110, revenue: 420 }),
      makeFactRow({ d: { value: "2026-04-11" }, spend: 130, revenue: 460 }),
      makeFactRow({ d: { value: "2026-04-12" }, spend: 140, revenue: 480 }),
      makeFactRow({ d: { value: "2026-04-13" }, spend: 150, revenue: 500 }),
      makeFactRow({ d: { value: "2026-04-14" }, spend: 200, revenue: 600 }),
    ];
    const attrRows: AttributionRow[] = [
      { d: { value: "2026-04-14" }, direct: 400, halo: 100, vt: 50, spend: 200 },
    ];
    const configRows = [makeCampaignConfigRow()];
    const compRows = [makeCompetitionRow()];

    const report = buildDailyReport(
      "team-1", "Test Team", "2026-04-14",
      defaultConfig, factRows, attrRows, configRows, compRows,
    );

    expect(report.teamId).toBe("team-1");
    expect(report.teamName).toBe("Test Team");
    expect(report.reportDate).toBe("2026-04-14");
    expect(report.score).toBeDefined();
    expect(report.score.score).toBeGreaterThanOrEqual(0);
    expect(report.score.score).toBeLessThanOrEqual(100);
    expect(report.yesterday).toBeDefined();
    expect(report.weekAvg).toBeDefined();
    expect(report.campaigns).toHaveLength(1);
    expect(report.categoryCompetition).toHaveLength(1);
    expect(report.generatedAt).toBeDefined();
  });

  it("handles empty fact data (new vendor)", () => {
    const report = buildDailyReport(
      "team-new", "New Team", "2026-04-14",
      defaultConfig, [], [], [], [],
    );

    expect(report.yesterday.spend).toBe(0);
    expect(report.yesterday.roas).toBe(0);
    expect(report.campaigns).toHaveLength(0);
    expect(report.recommendations).toHaveLength(0);
    expect(report.score.score).toBeGreaterThanOrEqual(0);
  });

  it("handles single category campaign", () => {
    const factRows = [makeFactRow()];
    const configRows = [makeCampaignConfigRow()];

    const report = buildDailyReport(
      "team-1", "Test", "2026-04-14",
      defaultConfig, factRows, [], configRows, [],
    );

    expect(report.campaigns).toHaveLength(1);
  });

  it("generates category_remove recommendation for low ROAS category", () => {
    // Category with terrible ROAS consuming >10% budget
    const factRows: FactRow[] = [
      makeFactRow({
        d: { value: "2026-04-14" },
        category: "BadCategory",
        spend: 2000, // 20% of budget (10000)
        revenue: 100, // ROAS = 0.05, target = 3 -> way below 50%
      }),
      makeFactRow({
        d: { value: "2026-04-14" },
        category: "GoodCategory",
        spend: 500,
        revenue: 5000,
      }),
    ];
    const configRows = [makeCampaignConfigRow({ budget: 10000 })];
    const compRows = [
      makeCompetitionRow({ category: "BadCategory" }),
      makeCompetitionRow({ category: "GoodCategory" }),
    ];

    const report = buildDailyReport(
      "team-1", "Test", "2026-04-14",
      defaultConfig, factRows, [], configRows, compRows,
    );

    const removeRecs = report.recommendations.filter((r) => r.type === "category_remove");
    expect(removeRecs.length).toBeGreaterThan(0);
    expect(removeRecs[0].category).toBe("BadCategory");
  });

  it("generates bid_decrease recommendation for expensive low-ROAS campaign", () => {
    // Campaign with CPC way above market and low ROAS
    const factRows: FactRow[] = [
      makeFactRow({
        d: { value: "2026-04-14" },
        spend: 5000,
        revenue: 2000, // ROAS = 0.4, target = 3 -> below 70%
        clicks: 100,   // CPC = 50
      }),
    ];
    const configRows = [makeCampaignConfigRow({ max_cost_per_click: 50 })];
    const compRows = [makeCompetitionRow({ market_cpc: 8 })]; // our CPC 50 >> market 8

    const report = buildDailyReport(
      "team-1", "Test", "2026-04-14",
      defaultConfig, factRows, [], configRows, compRows,
    );

    const bidDecRecs = report.recommendations.filter((r) => r.type === "bid_decrease");
    expect(bidDecRecs.length).toBeGreaterThan(0);
  });

  it("generates bid_increase recommendation for well-performing but low-position campaign", () => {
    const factRows: FactRow[] = [
      makeFactRow({
        d: { value: "2026-04-14" },
        spend: 500,
        revenue: 5000, // ROAS = 10, target = 3 -> above 130%
        clicks: 100,   // CPC = 5
        position_sum: 400, // avg pos = 400/100 = 4 > 3
        position_count: 100,
      }),
    ];
    const configRows = [makeCampaignConfigRow({ max_cost_per_click: 15 })]; // CPC 5 < 80% of 15 = 12
    const compRows = [makeCompetitionRow()];

    const report = buildDailyReport(
      "team-1", "Test", "2026-04-14",
      defaultConfig, factRows, [], configRows, compRows,
    );

    const bidIncRecs = report.recommendations.filter((r) => r.type === "bid_increase");
    expect(bidIncRecs.length).toBeGreaterThan(0);
  });

  it("sorts recommendations by severity (high first)", () => {
    const factRows: FactRow[] = [
      makeFactRow({
        d: { value: "2026-04-14" },
        category: "Bad",
        spend: 2000, revenue: 100,
      }),
      makeFactRow({
        d: { value: "2026-04-14" },
        category: "Good",
        spend: 100, revenue: 5000,
      }),
    ];
    const configRows = [makeCampaignConfigRow({ budget: 10000 })];

    const report = buildDailyReport(
      "team-1", "Test", "2026-04-14",
      defaultConfig, factRows, [], configRows, [],
    );

    if (report.recommendations.length > 1) {
      const sevOrder = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < report.recommendations.length; i++) {
        expect(sevOrder[report.recommendations[i].severity])
          .toBeGreaterThanOrEqual(sevOrder[report.recommendations[i - 1].severity]);
      }
    }
  });

  it("generates category_add recommendation for high-ROAS low-util campaign", () => {
    const factRows: FactRow[] = [
      makeFactRow({
        d: { value: "2026-04-14" },
        spend: 500,     // 5% of 10000 budget -> util < 70%
        revenue: 5000,  // ROAS = 10, target = 3 -> above 150%
      }),
    ];
    const configRows = [makeCampaignConfigRow({ budget: 10000 })];

    const report = buildDailyReport(
      "team-1", "Test", "2026-04-14",
      defaultConfig, factRows, [], configRows, [],
    );

    const addRecs = report.recommendations.filter((r) => r.type === "category_add");
    expect(addRecs.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Map functions
// ---------------------------------------------------------------------------

describe("mapCampaignConfigs", () => {
  it("maps raw rows to CampaignConfig", () => {
    const rows = [makeCampaignConfigRow()];
    const result = mapCampaignConfigs(rows);
    expect(result).toHaveLength(1);
    expect(result[0].campaignId).toBe("camp-1");
    expect(result[0].maxCpc).toBe(10);
  });
});

describe("mapCategoryCompetition", () => {
  it("maps raw rows to CategoryCompetition", () => {
    const rows = [makeCompetitionRow()];
    const result = mapCategoryCompetition(rows);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("Notebooky");
    expect(result[0].clickShare).toBe(0.15);
  });
});

describe("aggregateAttribution", () => {
  it("maps raw rows to AttributionMetrics", () => {
    const rows: AttributionRow[] = [
      { d: { value: "2026-04-14" }, direct: 1000, halo: 200, vt: 50, spend: 500 },
    ];
    const result = aggregateAttribution(rows);
    expect(result).toHaveLength(1);
    expect(result[0].directRevenue).toBe(1000);
    expect(result[0].haloRevenue).toBe(200);
  });
});
