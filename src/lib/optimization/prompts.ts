// ---------------------------------------------------------------------------
// Claude prompt templates for AI analysis
// ---------------------------------------------------------------------------

import type { AIAnalysisInput, AIAnalysisResponse } from "./types";

export function buildAnalysisPrompt(input: AIAnalysisInput): string {
  const modeLabel =
    input.config.mode === "sales" ? "prodejní" :
    input.config.mode === "brand_awareness" ? "budování povědomí" : "vlastní";

  // Keep prompt compact — summarize data instead of dumping full JSON
  const topCampaigns = input.campaigns.slice(0, 5).map((c) =>
    `${c.campaignName}: spend ${c.spend}, revenue ${c.revenue}, ROAS ${c.roas}x, CTR ${(c.ctr * 100).toFixed(2)}%, recs: ${c.recommendations.length}`
  ).join("\n");

  const topRecs = input.recommendations.slice(0, 8).map((r) =>
    `[${r.severity}] ${r.type}: ${r.campaignName}${r.category ? "/" + r.category : ""} — ${r.reason}`
  ).join("\n");

  const topComp = input.categoryCompetition.slice(0, 5).map((c) =>
    `${c.category}: ${c.competitors} competitors, market CPC ${c.marketCpc}, click share ${(c.clickShare * 100).toFixed(1)}%`
  ).join("\n");

  const alerts = input.alerts.map((a) => `[${a.severity}] ${a.message}`).join("\n");

  const prompt = `Jsi senior account manager pro AlzaAds. Analyzuješ výkon kampaní pro "${input.teamName}".

Režim: ${modeLabel}, cílové ROAS: ${input.config.targetRoas / 100}x, skóre: ${input.score.score}/100

Poslední den vs průměr období:
Spend: ${input.yesterday.spend} vs ${input.weekAvg.spend} (${input.deltas.spend > 0 ? "+" : ""}${input.deltas.spend}%)
Revenue: ${input.yesterday.revenue} vs ${input.weekAvg.revenue} (${input.deltas.revenue > 0 ? "+" : ""}${input.deltas.revenue}%)
ROAS: ${input.yesterday.roas} vs ${input.weekAvg.roas} (${input.deltas.roas > 0 ? "+" : ""}${input.deltas.roas}%)
CTR: ${(input.yesterday.ctr * 100).toFixed(2)}% vs ${(input.weekAvg.ctr * 100).toFixed(2)}%
CPC: ${input.yesterday.cpc} vs ${input.weekAvg.cpc}

Top 5 kampaní:
${topCampaigns}

Doporučení (${input.recommendations.length}):
${topRecs || "Žádná"}

Alerty:
${alerts || "Žádné"}

Konkurence (top 5 kategorií):
${topComp || "Žádná data"}

Odpověz POUZE validním JSON (bez markdown). Buď stručný. Max 5 akcí, krátké věty. Česky.
{"summary":"...","prioritizedActions":[{"priority":1,"action":"...","expectedImpact":"...","effort":"low|medium|high"}],"categoryRecommendations":["..."],"bidRecommendations":["..."],"riskAssessment":"..."}`;

  return prompt;
}

export function parseAnalysisResponse(text: string): AIAnalysisResponse {
  let cleaned = text.trim();

  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?\s*```\s*$/, "");
  }

  // Try to parse as-is first
  try {
    return validateAndReturn(JSON.parse(cleaned));
  } catch {
    // JSON might be truncated — try to repair
  }

  // Attempt repair: close any open strings, arrays, objects
  const repaired = repairTruncatedJson(cleaned);
  try {
    return validateAndReturn(JSON.parse(repaired));
  } catch {
    // Last resort: extract what we can with regex
  }

  // Fallback: extract summary from raw text
  return {
    summary: extractField(cleaned, "summary") || cleaned.slice(0, 500),
    prioritizedActions: [],
    categoryRecommendations: [],
    bidRecommendations: [],
    riskAssessment: extractField(cleaned, "riskAssessment") || "",
  };
}

function validateAndReturn(parsed: Record<string, unknown>): AIAnalysisResponse {
  return {
    summary: String(parsed.summary || ""),
    prioritizedActions: Array.isArray(parsed.prioritizedActions)
      ? (parsed.prioritizedActions as AIAnalysisResponse["prioritizedActions"]).slice(0, 5)
      : [],
    categoryRecommendations: Array.isArray(parsed.categoryRecommendations)
      ? (parsed.categoryRecommendations as string[])
      : [],
    bidRecommendations: Array.isArray(parsed.bidRecommendations)
      ? (parsed.bidRecommendations as string[])
      : [],
    riskAssessment: String(parsed.riskAssessment || ""),
  };
}

function repairTruncatedJson(s: string): string {
  // Count open/close braces and brackets
  let result = s;

  // If we're inside an unterminated string, close it
  let inString = false;
  let escaped = false;
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; }
  }
  if (inString) {
    result += '"';
  }

  // Close open brackets and braces
  const stack: string[] = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  // Remove any trailing comma before closing
  result = result.replace(/,\s*$/, "");

  // Close all open structures
  while (stack.length > 0) {
    result += stack.pop();
  }

  return result;
}

function extractField(json: string, field: string): string | null {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "s");
  const match = json.match(re);
  return match ? match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n") : null;
}
