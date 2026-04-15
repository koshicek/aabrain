import { describe, it, expect } from "vitest";
import { parseAnalysisResponse, buildAnalysisPrompt } from "../prompts";
import type { AIAnalysisInput } from "../types";

describe("parseAnalysisResponse", () => {
  const validJson = JSON.stringify({
    summary: "Test summary",
    prioritizedActions: [{ priority: 1, action: "Do X", expectedImpact: "High", effort: "low" }],
    categoryRecommendations: ["Rec 1"],
    bidRecommendations: ["Bid 1"],
    riskAssessment: "Some risk",
  });

  it("parses valid JSON response", () => {
    const result = parseAnalysisResponse(validJson);
    expect(result.summary).toBe("Test summary");
    expect(result.prioritizedActions).toHaveLength(1);
    expect(result.categoryRecommendations).toHaveLength(1);
    expect(result.riskAssessment).toBe("Some risk");
  });

  it("strips markdown code fences", () => {
    const wrapped = "```json\n" + validJson + "\n```";
    const result = parseAnalysisResponse(wrapped);
    expect(result.summary).toBe("Test summary");
  });

  it("strips code fences with extra whitespace", () => {
    const wrapped = "```json\n" + validJson + "\n```  ";
    const result = parseAnalysisResponse(wrapped);
    expect(result.summary).toBe("Test summary");
  });

  it("handles truncated JSON — unterminated string", () => {
    const truncated = '{"summary":"Toto je zku';
    const result = parseAnalysisResponse(truncated);
    expect(result.summary).toContain("Toto je zku");
  });

  it("handles truncated JSON — open array", () => {
    const truncated = '{"summary":"OK","prioritizedActions":[{"priority":1,"action":"Do X","expectedImpact":"Y","effort":"low"}';
    const result = parseAnalysisResponse(truncated);
    expect(result.summary).toBe("OK");
  });

  it("handles truncated JSON — trailing comma", () => {
    const truncated = '{"summary":"OK","prioritizedActions":[],';
    const result = parseAnalysisResponse(truncated);
    expect(result.summary).toBe("OK");
  });

  it("handles missing optional fields", () => {
    const minimal = '{"summary":"Minimal","prioritizedActions":[]}';
    const result = parseAnalysisResponse(minimal);
    expect(result.summary).toBe("Minimal");
    expect(result.categoryRecommendations).toEqual([]);
    expect(result.bidRecommendations).toEqual([]);
    expect(result.riskAssessment).toBe("");
  });

  it("caps prioritizedActions at 5", () => {
    const many = JSON.stringify({
      summary: "Test",
      prioritizedActions: Array.from({ length: 10 }, (_, i) => ({
        priority: i + 1, action: `Action ${i}`, expectedImpact: "X", effort: "low",
      })),
      categoryRecommendations: [],
      bidRecommendations: [],
      riskAssessment: "",
    });
    const result = parseAnalysisResponse(many);
    expect(result.prioritizedActions).toHaveLength(5);
  });

  it("handles completely invalid text — falls back to raw", () => {
    const garbage = "This is not JSON at all, just some text about campaigns.";
    const result = parseAnalysisResponse(garbage);
    expect(result.summary).toContain("This is not JSON");
    expect(result.prioritizedActions).toEqual([]);
  });
});

describe("buildAnalysisPrompt", () => {
  const input: AIAnalysisInput = {
    teamName: "Test Team",
    config: { mode: "sales", targetRoas: 300, revenuePriority: true, impressionPriority: false },
    score: { score: 75, color: "green", breakdown: { roasScore: 30, budgetScore: 20, trendScore: 15, issueScore: 10 } },
    yesterday: { spend: 1000, revenue: 3000, roas: 3, impressions: 10000, clicks: 500, ctr: 0.05, cpc: 2, units: 50 },
    weekAvg: { spend: 900, revenue: 2700, roas: 3, impressions: 9000, clicks: 450, ctr: 0.05, cpc: 2, units: 45 },
    deltas: { spend: 11.1, revenue: 11.1, roas: 0, impressions: 11.1, clicks: 11.1, ctr: 0, cpc: 0, units: 11.1 },
    recommendations: [],
    alerts: [],
    campaigns: [],
    categoryCompetition: [],
  };

  it("produces a compact prompt under 2000 chars with no data", () => {
    const prompt = buildAnalysisPrompt(input);
    expect(prompt.length).toBeLessThan(2000);
    expect(prompt).toContain("Test Team");
    expect(prompt).toContain("3x");
    expect(prompt).toContain("JSON");
  });

  it("includes campaign names when present", () => {
    const withCampaigns = {
      ...input,
      campaigns: [{
        campaignId: "c1", campaignName: "Big Campaign", activeState: "ACTIVE",
        spend: 500, revenue: 1500, roas: 3, impressions: 5000, clicks: 250, ctr: 0.05, cpc: 2,
        recommendations: [],
      }],
    };
    const prompt = buildAnalysisPrompt(withCampaigns);
    expect(prompt).toContain("Big Campaign");
  });
});
