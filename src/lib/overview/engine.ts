// ---------------------------------------------------------------------------
// Overview data aggregation engine
// ---------------------------------------------------------------------------

import type {
  WeeklyMetrics,
  CountryWeekly,
  QuarterMetrics,
  TotalWeekly,
  DailyOverview,
  TopVendor,
  OverviewReport,
} from "./types";
import type { ExchangeRates } from "@/lib/optimization/currency";
import { toCzk } from "@/lib/optimization/currency";

const CC: Record<string, string> = { CZK: "CZ", EUR: "SK", HUF: "HU" };

function bqDate(d: { value: string } | string): string {
  return typeof d === "object" && d !== null && "value" in d ? d.value : String(d);
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v));
  return isNaN(n) ? 0 : n;
}

function getWeekNumber(dateStr: string): number {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;
  return Math.ceil((dayOfYear + jan1.getDay()) / 7);
}

function formatDateRange(weekStart: string): string {
  const d = new Date(weekStart);
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const f = (dt: Date) => `${dt.getDate()}.${dt.getMonth() + 1}`;
  return `${f(d)}–${f(end)}`;
}

function getQuarter(dateStr: string): number {
  return Math.floor(new Date(dateStr).getMonth() / 3) + 1;
}

// ---------------------------------------------------------------------------
// Build weekly metrics per country
// ---------------------------------------------------------------------------

export function buildOverviewReport(
  weeklyRows: Array<{
    week_start: { value: string } | string;
    currency: string;
    active_vendors: number;
    active_campaigns: number;
    revenue: number;
    spend: number;
  }>,
  globalVendorRows: Array<{
    week_start: { value: string } | string;
    unique_vendors: number;
  }>,
  dailyRows: Array<{
    d: { value: string } | string;
    currency: string;
    active_vendors: number;
    active_campaigns: number;
    revenue: number;
    spend: number;
  }>,
  vendorRows: Array<{
    supplier_id: string;
    team_name: string;
    week_start: { value: string } | string;
    currency: string;
    revenue: number;
    spend: number;
  }>,
  rates: ExchangeRates,
  dateFrom: string,
  dateTo: string,
): OverviewReport {
  // ── Weekly by country ──
  const countryCurrencyMap: Record<string, string> = {};
  const weeksByCountry = new Map<string, Map<string, WeeklyMetrics>>();

  for (const r of weeklyRows) {
    const ws = bqDate(r.week_start);
    const cur = r.currency || "CZK";
    const country = CC[cur] || "CZ";
    countryCurrencyMap[country] = cur;

    if (!weeksByCountry.has(country)) weeksByCountry.set(country, new Map());
    const weeks = weeksByCountry.get(country)!;

    const existing = weeks.get(ws);
    const rev = num(r.revenue);
    const sp = num(r.spend);
    const vendors = num(r.active_vendors);
    const camps = num(r.active_campaigns);

    if (existing) {
      existing.revenue += rev;
      existing.spend += sp;
      existing.activeVendors += vendors;
      existing.activeCampaigns += camps;
      existing.roas = existing.spend > 0 ? Math.round((existing.revenue / existing.spend) * 100) / 100 : 0;
    } else {
      weeks.set(ws, {
        weekStart: ws,
        weekLabel: `W${getWeekNumber(ws)}`,
        weekRange: formatDateRange(ws),
        currency: cur,
        activeVendors: vendors,
        activeCampaigns: camps,
        revenue: rev,
        spend: sp,
        roas: sp > 0 ? Math.round((rev / sp) * 100) / 100 : 0,
      });
    }
  }

  const countries: CountryWeekly[] = ["CZ", "SK", "HU"]
    .filter((c) => weeksByCountry.has(c))
    .map((country) => {
      const weeksMap = weeksByCountry.get(country)!;
      const weeks = Array.from(weeksMap.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
      const cur = countryCurrencyMap[country] || "CZK";

      // Quarterly aggregation
      const quarterMap = new Map<number, { vendors: Set<string>; campaigns: Set<string>; revenue: number; spend: number }>();
      // We need distinct counts per quarter — approximate by summing maxes
      const qAgg = new Map<number, { revenue: number; spend: number; maxVendors: number; maxCampaigns: number }>();
      for (const w of weeks) {
        const q = getQuarter(w.weekStart);
        const ex = qAgg.get(q) || { revenue: 0, spend: 0, maxVendors: 0, maxCampaigns: 0 };
        ex.revenue += w.revenue;
        ex.spend += w.spend;
        ex.maxVendors = Math.max(ex.maxVendors, w.activeVendors);
        ex.maxCampaigns = Math.max(ex.maxCampaigns, w.activeCampaigns);
        qAgg.set(q, ex);
      }

      const quarters: QuarterMetrics[] = Array.from(qAgg.entries())
        .sort(([a], [b]) => a - b)
        .map(([q, data]) => ({
          label: `Q${q}`,
          activeVendors: data.maxVendors,
          activeCampaigns: data.maxCampaigns,
          revenue: Math.round(data.revenue * 100) / 100,
          revenueCzk: Math.round(toCzk(data.revenue, cur, rates) * 100) / 100,
          spend: Math.round(data.spend * 100) / 100,
          roas: data.spend > 0 ? Math.round((data.revenue / data.spend) * 100) / 100 : 0,
        }));

      return { country, currency: cur, weeks, quarters };
    });

  // ── Global deduplicated vendor counts ──
  const globalVendorMap = new Map<string, number>();
  for (const r of globalVendorRows) {
    globalVendorMap.set(bqDate(r.week_start), num(r.unique_vendors));
  }

  // ── Totals (all countries, converted to CZK) ──
  const totalWeeksMap = new Map<string, TotalWeekly>();
  for (const c of countries) {
    for (const w of c.weeks) {
      const existing = totalWeeksMap.get(w.weekStart);
      const revCzk = toCzk(w.revenue, w.currency, rates);
      const spCzk = toCzk(w.spend, w.currency, rates);
      if (existing) {
        existing.activeVendors += w.activeVendors;
        existing.activeCampaigns += w.activeCampaigns;
        existing.revenueCzk += revCzk;
        existing.spendCzk += spCzk;
        existing.roas = existing.spendCzk > 0 ? Math.round((existing.revenueCzk / existing.spendCzk) * 100) / 100 : 0;
      } else {
        totalWeeksMap.set(w.weekStart, {
          weekStart: w.weekStart,
          weekLabel: w.weekLabel,
          weekRange: w.weekRange,
          activeVendors: w.activeVendors,
          uniqueVendors: globalVendorMap.get(w.weekStart) || 0,
          activeCampaigns: w.activeCampaigns,
          revenueCzk: revCzk,
          spendCzk: spCzk,
          roas: spCzk > 0 ? Math.round((revCzk / spCzk) * 100) / 100 : 0,
        });
      }
    }
  }
  const totals = Array.from(totalWeeksMap.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Total quarters
  const tqMap = new Map<number, { revCzk: number; spCzk: number; maxV: number; maxC: number }>();
  for (const t of totals) {
    const q = getQuarter(t.weekStart);
    const ex = tqMap.get(q) || { revCzk: 0, spCzk: 0, maxV: 0, maxC: 0 };
    ex.revCzk += t.revenueCzk;
    ex.spCzk += t.spendCzk;
    ex.maxV = Math.max(ex.maxV, t.activeVendors);
    ex.maxC = Math.max(ex.maxC, t.activeCampaigns);
    tqMap.set(q, ex);
  }
  const totalQuarters: QuarterMetrics[] = Array.from(tqMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([q, d]) => ({
      label: `Q${q}`,
      activeVendors: d.maxV,
      activeCampaigns: d.maxC,
      revenue: d.revCzk,
      revenueCzk: Math.round(d.revCzk * 100) / 100,
      spend: d.spCzk,
      roas: d.spCzk > 0 ? Math.round((d.revCzk / d.spCzk) * 100) / 100 : 0,
    }));

  // ── Daily view (converted to CZK) ──
  const dailyMap = new Map<string, DailyOverview>();
  for (const r of dailyRows) {
    const d = bqDate(r.d);
    const cur = r.currency || "CZK";
    const revCzk = toCzk(num(r.revenue), cur, rates);
    const spCzk = toCzk(num(r.spend), cur, rates);
    const existing = dailyMap.get(d);
    if (existing) {
      existing.revenueCzk += revCzk;
      existing.spendCzk += spCzk;
      existing.activeVendors += num(r.active_vendors);
      existing.activeCampaigns += num(r.active_campaigns);
      existing.roas = existing.spendCzk > 0 ? Math.round((existing.revenueCzk / existing.spendCzk) * 100) / 100 : 0;
    } else {
      dailyMap.set(d, {
        date: d,
        revenueCzk: revCzk,
        spendCzk: spCzk,
        activeVendors: num(r.active_vendors),
        activeCampaigns: num(r.active_campaigns),
        roas: spCzk > 0 ? Math.round((revCzk / spCzk) * 100) / 100 : 0,
      });
    }
  }
  const dailyView = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // ── Top 10 vendors (WoW) ──
  // Get the two most recent week starts
  const vendorWeekStarts = new Set(vendorRows.map((r) => bqDate(r.week_start)));
  const sortedWeeks = Array.from(vendorWeekStarts).sort().reverse();
  const thisWeek = sortedWeeks[0] || "";
  const lastWeek = sortedWeeks[1] || "";

  // Aggregate per vendor per week (convert to CZK)
  const vendorAgg = new Map<string, { name: string; thisRev: number; lastRev: number; thisSpend: number; lastSpend: number }>();
  for (const r of vendorRows) {
    const ws = bqDate(r.week_start);
    if (ws !== thisWeek && ws !== lastWeek) continue;
    const key = r.supplier_id;
    const cur = r.currency || "CZK";
    const revCzk = toCzk(num(r.revenue), cur, rates);
    const spCzk = toCzk(num(r.spend), cur, rates);
    const ex = vendorAgg.get(key) || { name: r.team_name || key, thisRev: 0, lastRev: 0, thisSpend: 0, lastSpend: 0 };
    if (ws === thisWeek) {
      ex.thisRev += revCzk;
      ex.thisSpend += spCzk;
    } else {
      ex.lastRev += revCzk;
      ex.lastSpend += spCzk;
    }
    vendorAgg.set(key, ex);
  }

  const topVendors: TopVendor[] = Array.from(vendorAgg.entries())
    .map(([id, v]) => ({
      vendorId: id,
      vendorName: v.name,
      thisWeekRevenue: Math.round(v.thisRev),
      lastWeekRevenue: Math.round(v.lastRev),
      thisWeekSpend: Math.round(v.thisSpend),
      lastWeekSpend: Math.round(v.lastSpend),
      thisWeekRoas: v.thisSpend > 0 ? Math.round((v.thisRev / v.thisSpend) * 100) / 100 : 0,
      lastWeekRoas: v.lastSpend > 0 ? Math.round((v.lastRev / v.lastSpend) * 100) / 100 : 0,
      revenueChange: v.lastRev > 0 ? Math.round(((v.thisRev - v.lastRev) / v.lastRev) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.thisWeekRevenue - a.thisWeekRevenue)
    .slice(0, 10);

  return {
    dateFrom,
    dateTo,
    countries,
    totals,
    totalQuarters,
    dailyView,
    topVendors,
    generatedAt: new Date().toISOString(),
  };
}
