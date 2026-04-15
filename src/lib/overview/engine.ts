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
  QuarterlyActual,
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

function getQuarter(weekStartStr: string): number {
  // Use Thursday of the week to determine quarter (ISO standard)
  const thu = new Date(weekStartStr);
  thu.setDate(thu.getDate() + 3);
  return Math.floor(thu.getMonth() / 3) + 1;
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
    obrat: number;
    sales_revenue: number;
  }>,
  globalVendorRows: Array<{
    week_start: { value: string } | string;
    unique_vendors: number;
  }>,
  quarterlyRows: Array<{
    q: number;
    currency: string;
    obrat: number;
  }>,
  dailyRows: Array<{
    d: { value: string } | string;
    currency: string;
    active_vendors: number;
    active_campaigns: number;
    obrat: number;
    sales_revenue: number;
  }>,
  vendorRows: Array<{
    supplier_id: string;
    team_name: string;
    week_start: { value: string } | string;
    currency: string;
    obrat: number;
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
    const obrat = num(r.obrat);           // ad_spend = AlzaAds revenue
    const salesRev = num(r.sales_revenue); // vendor product sales
    const vendors = num(r.active_vendors);
    const camps = num(r.active_campaigns);

    if (existing) {
      existing.revenue += obrat;
      existing.spend += salesRev;
      existing.activeVendors += vendors;
      existing.activeCampaigns += camps;
      existing.roas = existing.revenue > 0 ? Math.round((existing.spend / existing.revenue) * 100) / 100 : 0;
    } else {
      weeks.set(ws, {
        weekStart: ws,
        weekLabel: `W${getWeekNumber(ws)}`,
        weekRange: formatDateRange(ws),
        currency: cur,
        activeVendors: vendors,
        activeCampaigns: camps,
        revenue: obrat,           // "Celkový obrat" = ad_spend
        spend: salesRev,          // keep sales_revenue for ROAS calc
        roas: obrat > 0 ? Math.round((salesRev / obrat) * 100) / 100 : 0,
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
          revenue: Math.round(data.revenue * 100) / 100,           // obrat in local currency
          revenueCzk: Math.round(toCzk(data.revenue, cur, rates) * 100) / 100,
          spend: Math.round(data.spend * 100) / 100,               // sales_revenue
          roas: data.revenue > 0 ? Math.round((data.spend / data.revenue) * 100) / 100 : 0,  // sales_rev / obrat
        }));

      return { country, currency: cur, weeks, quarters };
    });

  // ── Global deduplicated vendor counts ──
  const globalVendorMap = new Map<string, number>();
  for (const r of globalVendorRows) {
    globalVendorMap.set(bqDate(r.week_start), num(r.unique_vendors));
  }

  // ── Totals (all countries, converted to CZK) ──
  // revenueCzk = obrat (ad_spend) in CZK, spendCzk = sales_revenue in CZK (for ROAS)
  const totalWeeksMap = new Map<string, TotalWeekly>();
  for (const c of countries) {
    for (const w of c.weeks) {
      const existing = totalWeeksMap.get(w.weekStart);
      const obratCzk = toCzk(w.revenue, w.currency, rates);   // obrat = ad_spend
      const salesCzk = toCzk(w.spend, w.currency, rates);     // sales_revenue for ROAS
      if (existing) {
        existing.activeVendors += w.activeVendors;
        existing.activeCampaigns += w.activeCampaigns;
        existing.revenueCzk += obratCzk;
        existing.spendCzk += salesCzk;
        existing.roas = existing.revenueCzk > 0 ? Math.round((existing.spendCzk / existing.revenueCzk) * 100) / 100 : 0;
      } else {
        totalWeeksMap.set(w.weekStart, {
          weekStart: w.weekStart,
          weekLabel: w.weekLabel,
          weekRange: w.weekRange,
          activeVendors: w.activeVendors,
          uniqueVendors: globalVendorMap.get(w.weekStart) || 0,
          activeCampaigns: w.activeCampaigns,
          revenueCzk: obratCzk,
          spendCzk: salesCzk,
          roas: obratCzk > 0 ? Math.round((salesCzk / obratCzk) * 100) / 100 : 0,
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
      revenue: d.revCzk,           // obrat in CZK
      revenueCzk: Math.round(d.revCzk * 100) / 100,
      spend: d.spCzk,              // sales_revenue in CZK
      roas: d.revCzk > 0 ? Math.round((d.spCzk / d.revCzk) * 100) / 100 : 0,  // sales/obrat
    }));

  // ── Daily view (converted to CZK) ──
  // revenueCzk = obrat (ad_spend), spendCzk = sales_revenue (for ROAS)
  const dailyMap = new Map<string, DailyOverview>();
  for (const r of dailyRows) {
    const d = bqDate(r.d);
    const cur = r.currency || "CZK";
    const obratCzk = toCzk(num(r.obrat), cur, rates);
    const salesCzk = toCzk(num(r.sales_revenue), cur, rates);
    const existing = dailyMap.get(d);
    if (existing) {
      existing.revenueCzk += obratCzk;
      existing.spendCzk += salesCzk;
      existing.activeVendors += num(r.active_vendors);
      existing.activeCampaigns += num(r.active_campaigns);
      existing.roas = existing.revenueCzk > 0 ? Math.round((existing.spendCzk / existing.revenueCzk) * 100) / 100 : 0;
    } else {
      dailyMap.set(d, {
        date: d,
        revenueCzk: obratCzk,
        spendCzk: salesCzk,
        activeVendors: num(r.active_vendors),
        activeCampaigns: num(r.active_campaigns),
        roas: obratCzk > 0 ? Math.round((salesCzk / obratCzk) * 100) / 100 : 0,
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

  // Aggregate per vendor per week (convert to CZK) — obrat = ad_spend
  const vendorAgg = new Map<string, { name: string; thisObrat: number; lastObrat: number }>();
  for (const r of vendorRows) {
    const ws = bqDate(r.week_start);
    if (ws !== thisWeek && ws !== lastWeek) continue;
    const key = r.supplier_id;
    const cur = r.currency || "CZK";
    const obratCzk = toCzk(num(r.obrat), cur, rates);
    const ex = vendorAgg.get(key) || { name: r.team_name || key, thisObrat: 0, lastObrat: 0 };
    if (ws === thisWeek) {
      ex.thisObrat += obratCzk;
    } else {
      ex.lastObrat += obratCzk;
    }
    vendorAgg.set(key, ex);
  }

  const topVendors: TopVendor[] = Array.from(vendorAgg.entries())
    .map(([id, v]) => ({
      vendorId: id,
      vendorName: v.name,
      thisWeekRevenue: Math.round(v.thisObrat),
      lastWeekRevenue: Math.round(v.lastObrat),
      thisWeekSpend: 0,
      lastWeekSpend: 0,
      thisWeekRoas: 0,
      lastWeekRoas: 0,
      revenueChange: v.lastObrat > 0 ? Math.round(((v.thisObrat - v.lastObrat) / v.lastObrat) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.thisWeekRevenue - a.thisWeekRevenue)
    .slice(0, 10);

  // ── Quarterly actuals (precise, from daily data, not weekly) ──
  const qaMap = new Map<number, number>();
  for (const r of quarterlyRows) {
    const q = num(r.q);
    const cur = r.currency || "CZK";
    const czk = toCzk(num(r.obrat), cur, rates);
    qaMap.set(q, (qaMap.get(q) || 0) + czk);
  }
  const quarterlyActuals: QuarterlyActual[] = [1, 2, 3, 4]
    .filter((q) => qaMap.has(q))
    .map((q) => ({ quarter: q, obratCzk: Math.round((qaMap.get(q) || 0) * 100) / 100 }));

  return {
    dateFrom,
    dateTo,
    quarterlyActuals,
    countries,
    totals,
    totalQuarters,
    dailyView,
    topVendors,
    generatedAt: new Date().toISOString(),
  };
}
