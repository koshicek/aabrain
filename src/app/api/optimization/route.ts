import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  queryFactData,
  queryAttribution,
  queryCampaignConfigs,
  queryCategoryCompetition,
} from "@/lib/optimization/queries";
import { buildDailyReport } from "@/lib/optimization/engine";
import { buildAnalysisPrompt, parseAnalysisResponse } from "@/lib/optimization/prompts";
import { cacheGet, cacheSet, optCacheKey } from "@/lib/optimization/cache";
import { getExchangeRates } from "@/lib/optimization/currency";
import type { TeamOptConfig, DailyReport, AIAnalysisInput, CountryFilter, CurrencyDisplay } from "@/lib/optimization/types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function getToken(req: NextRequest): string {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new Error("Missing authorization token");
  }
  return auth.slice(7);
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// GET: daily-report
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    getToken(req);
    const params = req.nextUrl.searchParams;
    const action = params.get("action");
    const teamId = params.get("teamId");
    const teamName = params.get("teamName") || teamId || "";

    if (!teamId) {
      return NextResponse.json({ error: "teamId required" }, { status: 400 });
    }

    if (action === "daily-report") {
      const dateTo = params.get("dateTo") || getYesterday();
      const dateFrom = params.get("dateFrom") || daysAgo(14);
      const campaignIdsParam = params.get("campaignIds");
      const campaignIds = campaignIdsParam ? campaignIdsParam.split(",").filter(Boolean) : undefined;
      const country = (params.get("country") || "all") as CountryFilter;
      const currencyDisplay = (params.get("currency") || "CZK") as CurrencyDisplay;

      // Cache key includes all filters
      const filterKey = campaignIds ? campaignIds.sort().join(":") : "all";
      const cacheKey = optCacheKey(teamId, `report:${dateFrom}:${dateTo}:${filterKey}:${country}:${currencyDisplay}`, dateTo);
      const cached = cacheGet<DailyReport>(cacheKey);
      if (cached) {
        const configParam = params.get("config");
        if (configParam) {
          try {
            cached.config = JSON.parse(configParam) as TeamOptConfig;
          } catch { /* keep cached config */ }
        }
        return NextResponse.json(cached);
      }

      // Parse config
      let config: TeamOptConfig = {
        mode: "sales",
        targetRoas: 300,
        revenuePriority: true,
        impressionPriority: false,
      };
      const configParam = params.get("config");
      if (configParam) {
        try { config = JSON.parse(configParam) as TeamOptConfig; } catch { /* defaults */ }
      }

      // Fetch exchange rates (needed for currency conversion)
      const rates = currencyDisplay === "CZK" ? await getExchangeRates() : null;

      // Q4 has its own 7-day cache (not affected by date range)
      const q4CacheKey = optCacheKey(teamId, "campaign-configs", "static");
      let campaignConfigs = cacheGet<Awaited<ReturnType<typeof queryCampaignConfigs>>>(q4CacheKey);

      const [factRows, attrRows, competitionRows] = await Promise.all([
        queryFactData(teamId, dateFrom, dateTo, campaignIds),
        queryAttribution(teamId, dateFrom, dateTo, campaignIds),
        queryCategoryCompetition(teamId, dateFrom, dateTo, campaignIds),
      ]);

      if (!campaignConfigs) {
        campaignConfigs = await queryCampaignConfigs(teamId);
        cacheSet(q4CacheKey, campaignConfigs, SEVEN_DAYS_MS);
      }

      const report = buildDailyReport(
        teamId,
        teamName,
        dateTo,
        config,
        factRows,
        attrRows,
        campaignConfigs,
        competitionRows,
        country,
        currencyDisplay,
        rates,
        campaignIds,
      );

      cacheSet(cacheKey, report);
      return NextResponse.json(report);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    console.error("[optimization]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST: ai-analysis
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    getToken(req);
    const body = await req.json();

    if (body.action === "ai-analysis") {
      const { apiKey: clientKey, model, report } = body as {
        action: string;
        apiKey?: string;
        model?: string;
        report: DailyReport;
      };

      const apiKey = process.env.ANTHROPIC_API_KEY || clientKey;
      if (!apiKey) {
        return NextResponse.json(
          { error: "ANTHROPIC_API_KEY not configured. Set it in .env or provide via Settings." },
          { status: 400 },
        );
      }

      if (!report) {
        return NextResponse.json(
          { error: "Report data required" },
          { status: 400 },
        );
      }

      const input: AIAnalysisInput = {
        teamName: report.teamName,
        config: report.config,
        score: report.score,
        yesterday: report.yesterday,
        weekAvg: report.weekAvg,
        deltas: report.deltas,
        recommendations: report.recommendations,
        alerts: report.alerts,
        campaigns: report.campaigns,
        categoryCompetition: report.categoryCompetition,
      };

      const client = new Anthropic({ apiKey });
      const prompt = buildAnalysisPrompt(input);

      const message = await client.messages.create({
        model: model || "claude-sonnet-4-6",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const analysis = parseAnalysisResponse(text);

      return NextResponse.json(analysis);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    console.error("[optimization/ai]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
