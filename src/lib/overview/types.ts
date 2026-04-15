// ---------------------------------------------------------------------------
// Overview / Internal Reporting — Types
// ---------------------------------------------------------------------------

export interface WeeklyMetrics {
  weekStart: string;       // ISO date of Monday
  weekLabel: string;       // e.g. "W5"
  weekRange: string;       // e.g. "27.1–2.2"
  currency: string;        // CZK, EUR, HUF
  activeVendors: number;
  activeCampaigns: number;
  revenue: number;         // in original currency
  spend: number;
  roas: number;
}

export interface CountryWeekly {
  country: string;         // CZ, SK, HU
  currency: string;
  weeks: WeeklyMetrics[];
  quarters: QuarterMetrics[];
}

export interface QuarterMetrics {
  label: string;           // Q1, Q2, Q3, Q4
  activeVendors: number;
  activeCampaigns: number;
  revenue: number;
  revenueCzk: number;
  spend: number;
  roas: number;
}

export interface TotalWeekly {
  weekStart: string;
  weekLabel: string;
  weekRange: string;
  activeVendors: number;
  uniqueVendors: number;  // deduplicated across all markets
  activeCampaigns: number;
  revenueCzk: number;
  spendCzk: number;
  roas: number;
}

export interface DailyOverview {
  date: string;
  revenueCzk: number;
  spendCzk: number;
  activeVendors: number;
  activeCampaigns: number;
  roas: number;
}

export interface TopVendor {
  vendorId: string;
  vendorName: string;
  thisWeekRevenue: number;
  lastWeekRevenue: number;
  thisWeekSpend: number;
  lastWeekSpend: number;
  thisWeekRoas: number;
  lastWeekRoas: number;
  revenueChange: number;   // percentage
}

export interface QuarterlyActual {
  quarter: number;
  obratCzk: number;
}

export interface CountryQuarterlyActual {
  quarter: number;
  country: string;
  currency: string;
  obrat: number;       // in local currency
  obratCzk: number;
}

export interface OverviewReport {
  dateFrom: string;
  dateTo: string;
  quarterlyActuals: QuarterlyActual[];
  countryQuarterlyActuals: CountryQuarterlyActual[];
  countries: CountryWeekly[];
  totals: TotalWeekly[];
  totalQuarters: QuarterMetrics[];
  dailyView: DailyOverview[];
  topVendors: TopVendor[];
  generatedAt: string;
}
