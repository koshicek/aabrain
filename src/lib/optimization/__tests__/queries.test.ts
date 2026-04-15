import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/citrusad/bigquery", () => ({
  getClient: () => ({ query: mockQuery }),
}));

import {
  queryFactData,
  queryAttribution,
  queryCampaignConfigs,
  queryCategoryCompetition,
} from "../queries";

beforeEach(() => { mockQuery.mockReset(); });

describe("queryFactData", () => {
  it("executes parameterized query with dateFrom and dateTo", async () => {
    mockQuery.mockResolvedValue([[]]);
    await queryFactData("team-123", "2026-04-01", "2026-04-14");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const opts = mockQuery.mock.calls[0][0];
    expect(opts.params.teamId).toBe("team-123");
    expect(opts.params.dateFrom).toBe("2026-04-01");
    expect(opts.params.dateTo).toBe("2026-04-14");
    expect(opts.query).toContain("fact_realised_ad_agg");
    expect(opts.query).toContain("@teamId");
    expect(opts.query).toContain("@dateFrom");
    expect(opts.query).toContain("@dateTo");
  });

  it("includes campaign filter when campaignIds provided", async () => {
    mockQuery.mockResolvedValue([[]]);
    await queryFactData("team-1", "2026-04-01", "2026-04-14", ["c1", "c2"]);

    const opts = mockQuery.mock.calls[0][0];
    expect(opts.params.cid0).toBe("c1");
    expect(opts.params.cid1).toBe("c2");
    expect(opts.query).toContain("@cid0");
    expect(opts.query).toContain("@cid1");
  });

  it("returns typed rows", async () => {
    const mockRows = [
      { d: { value: "2026-04-14" }, campaign_id: "c1", category: "X", impressions: 100, clicks: 10, units: 2, spend: 50, revenue: 200, position_sum: 20, position_count: 10, product_count: 3 },
    ];
    mockQuery.mockResolvedValue([mockRows]);
    const result = await queryFactData("team-1", "2026-04-01", "2026-04-14");
    expect(result).toHaveLength(1);
    expect(result[0].campaign_id).toBe("c1");
  });

  it("returns empty array when no data", async () => {
    mockQuery.mockResolvedValue([[]]);
    const result = await queryFactData("team-new", "2026-04-01", "2026-04-14");
    expect(result).toEqual([]);
  });
});

describe("queryAttribution", () => {
  it("executes parameterized query for attribution with date range", async () => {
    mockQuery.mockResolvedValue([[]]);
    await queryAttribution("team-123", "2026-04-07", "2026-04-14");

    const opts = mockQuery.mock.calls[0][0];
    expect(opts.params.teamId).toBe("team-123");
    expect(opts.params.dateFrom).toBe("2026-04-07");
    expect(opts.params.dateTo).toBe("2026-04-14");
    expect(opts.query).toContain("fact_enhanced_attribution_agg");
  });

  it("returns attribution rows", async () => {
    mockQuery.mockResolvedValue([[
      { d: { value: "2026-04-14" }, direct: 1000, halo: 200, vt: 50, spend: 500 },
    ]]);
    const result = await queryAttribution("team-1", "2026-04-07", "2026-04-14");
    expect(result).toHaveLength(1);
    expect(result[0].direct).toBe(1000);
  });
});

describe("queryCampaignConfigs", () => {
  it("queries active/paused campaigns with wallet join", async () => {
    mockQuery.mockResolvedValue([[]]);
    await queryCampaignConfigs("team-123");

    const opts = mockQuery.mock.calls[0][0];
    expect(opts.params.teamId).toBe("team-123");
    expect(opts.query).toContain("dim_campaign");
    expect(opts.query).toContain("dim_wallet");
    expect(opts.query).toContain("ACTIVE");
    expect(opts.query).toContain("PAUSED");
  });
});

describe("queryCategoryCompetition", () => {
  it("queries competition data with click share", async () => {
    mockQuery.mockResolvedValue([[]]);
    await queryCategoryCompetition("team-123", "2026-04-07", "2026-04-14");

    const opts = mockQuery.mock.calls[0][0];
    expect(opts.query).toContain("click_share");
    expect(opts.query).toContain("competitors");
    expect(opts.query).toContain("market_cpc");
  });
});

describe("SQL safety", () => {
  it("uses parameterized queries, not string interpolation for user input", async () => {
    mockQuery.mockResolvedValue([[]]);
    const maliciousId = "'; DROP TABLE dim_campaign; --";

    await queryFactData(maliciousId, "2026-04-01", "2026-04-14");
    const opts = mockQuery.mock.calls[0][0];

    expect(opts.params.teamId).toBe(maliciousId);
    expect(opts.query).not.toContain(maliciousId);
    expect(opts.query).toContain("@teamId");
  });
});
