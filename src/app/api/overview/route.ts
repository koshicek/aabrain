import { NextRequest, NextResponse } from "next/server";
import { queryWeeklyByCountry, queryDailyOverview, queryTopVendors } from "@/lib/overview/queries";
import { buildOverviewReport } from "@/lib/overview/engine";
import { getExchangeRates } from "@/lib/optimization/currency";
import { cacheGet, cacheSet, optCacheKey } from "@/lib/optimization/cache";
import type { OverviewReport } from "@/lib/overview/types";

function getToken(req: NextRequest): string {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("Missing authorization token");
  return auth.slice(7);
}

function getYesterday(): string {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  try {
    getToken(req);
    const params = req.nextUrl.searchParams;
    const year = params.get("year") || new Date().getFullYear().toString();
    const dateFrom = `${year}-01-01`;
    const dateTo = params.get("dateTo") || getYesterday();

    const cacheKey = optCacheKey("overview", `${dateFrom}:${dateTo}`, dateTo);
    const cached = cacheGet<OverviewReport>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const rates = await getExchangeRates();

    const [weeklyRows, dailyRows, vendorRows] = await Promise.all([
      queryWeeklyByCountry(dateFrom, dateTo),
      queryDailyOverview(dateTo),
      queryTopVendors(dateTo),
    ]);

    const report = buildOverviewReport(weeklyRows, dailyRows, vendorRows, rates, dateFrom, dateTo);
    cacheSet(cacheKey, report);
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    console.error("[overview]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
