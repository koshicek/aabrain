export interface OktaTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface CitrusAdUser {
  id: string;
  namespace: string;
  isAdmin: boolean;
  consumedPermissions: Record<string, TeamPermission[]>;
}

export interface TeamPermission {
  subject: string;
  action: string;
}

export interface TeamInfo {
  team: {
    id: string;
    namespace: string;
    namespaceDisplayName: string;
    name: string;
    companyName?: string;
    companyType?: string;
  };
}

export interface Placement {
  id: string;
  adGenId: string;
  displayName: string;
  namespace: string;
  catalogIds: string[];
  campaignTypes: string[];
  campaignTarget: string;
  archived: boolean;
}

export interface ReportRequest {
  startInclusive: string;
  endExclusive: string;
  periodSeconds: number;
  filters: {
    campaignTeamIds?: string[];
    campaignIds?: string[];
    catalogIds?: string[];
  };
  reportRequesterTeamId: string;
  measures: string[];
  dimensionCombinations?: { dimensions: string[] }[];
  excludeFilters?: Record<string, string[]>;
}

export interface MeasureValue {
  measure: string;
  measuredValue: number;
}

export interface DimensionalMeasure {
  dimensionValues: { dimension: string; value: string }[];
  measures: MeasureValue[];
}

export interface ReportBucket {
  bucketStart: string;
  bucketLengthSeconds: number;
  overallMeasures: MeasureValue[];
  dimensionalMeasures: DimensionalMeasure[];
}

export interface ReportResponse {
  bucketedMeasureSummaries: ReportBucket[];
}

export interface ApiResponse<T> {
  isSuccessful: boolean;
  errorMessages: { message: string; code: string | null }[] | null;
  data?: T;
}

export const MEASURES = {
  Impressions: "MeasureValidImpressionCount",
  Clicks: "MeasureValidClickCount",
  Spend: "MeasureValidAdCostSum",
  ROAS: "MeasureSaleRevenueSum_Divide_ValidAdCostSum",
  CTR: "MeasureValidClickCount_Divide_ValidImpressionCount",
  CPC: "MeasureValidAdCostSum_Divide_ValidClickCount",
  CPM: "MeasureValidAdCostSum_Divide_ValidImpressionCount",
  Revenue: "MeasureSaleRevenueSum",
  Conversions: "MeasureSaleCount",
  ConversionRate: "MeasureConversionCount_Divide_ValidClickCount",
  CPA: "MeasureValidAdCostSum_Divide_SaleCount",
  AvgPosition: "MeasurePositionAverage",
  ActiveProducts: "MeasureProductCodeCountdistinct",
  AdRevenue: "MeasureValidAdRevenueSum",
  RevenuePerClick: "MeasureValidAdRevenueSum_Divide_ValidClickCount",
} as const;

export type MeasureKey = keyof typeof MEASURES;

export const CORE_MEASURES: MeasureKey[] = [
  "Impressions",
  "Clicks",
  "Spend",
  "ROAS",
];

export const EXTENDED_MEASURES: MeasureKey[] = [
  "CTR",
  "CPC",
  "CPM",
  "Revenue",
  "Conversions",
  "ConversionRate",
  "CPA",
];

export interface TeamWithName {
  id: string;
  name: string;
}

export interface Wallet {
  id: string;
  name: string;
  teamId: string;
  defaultWallet: boolean;
  archived: boolean;
  availableBalance?: number;
  currencyCode?: string;
}

export interface Campaign {
  id: string;
  name: string;
  teamId: string;
  campaignType: string;
  activeState: string;
  validState: string;
  walletId?: string;
  currencyCode?: string;
}
