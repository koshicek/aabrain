# AlzaAds (CitrusAd) Platform API Reference

Reverse-engineered from alzaads.citrusad.com on 2026-04-15.

## Base URL

```
https://gateway.eu2.citrusad.com/v1
```

## Authentication

Okta IDX credential-based flow:

1. `POST https://okta.citrusad.com/oauth2/aus2wlpl47Yx5o53g5d7/v1/interact`
   - Body: `client_id=0oa5orsjuyGCdBE315d7&scope=openid+profile&redirect_uri=https://alzaads.citrusad.com/okta/callback&state={state}&code_challenge={challenge}&code_challenge_method=S256`
   - Returns: `interaction_handle`

2. `POST https://okta.citrusad.com/idp/idx/introspect`
   - Header: `Content-Type: application/ion+json; okta-version=1.0.0`
   - Body: `{"interactionHandle": "{handle}"}`
   - Returns: `stateHandle`

3. `POST https://okta.citrusad.com/idp/idx/identify`
   - Body: `{"stateHandle": "{handle}", "identifier": "{email}"}`
   - Returns: updated `stateHandle`

4. `POST https://okta.citrusad.com/idp/idx/challenge/answer`
   - Body: `{"stateHandle": "{handle}", "credentials": {"passcode": "{password}"}}`
   - Returns: `successWithInteractionCode.value[].value` (interaction_code)

5. `POST https://okta.citrusad.com/oauth2/aus2wlpl47Yx5o53g5d7/v1/token`
   - Body: `grant_type=interaction_code&client_id=0oa5orsjuyGCdBE315d7&interaction_code={code}&code_verifier={verifier}&redirect_uri=https://alzaads.citrusad.com/okta/callback`
   - Returns: `access_token` (Bearer, 24h TTL)

## Required Headers

```
Authorization: Bearer {access_token}
citrus-namespace: alzaads
Content-Type: application/json  (for POST requests)
```

## Endpoints

### User

**GET /user/get-current-user**
Returns current user info including all team IDs in `consumedPermissions`.

Response:
```json
{
  "id": "uuid",
  "namespace": "alzaads",
  "isAdmin": false,
  "consumedPermissions": {
    "{teamId}": [{"subject": "Campaign", "action": "ReadWrite"}, ...]
  }
}
```

### Teams

**GET /team/info?teamId={teamId}**
Returns team details.

Response:
```json
{
  "team": {
    "id": "uuid",
    "namespace": "alzaads",
    "namespaceDisplayName": "Alza Ads",
    "name": "Team Name",
    "sentInvitations": {...}
  }
}
```

### Placements

**GET /catalog-v2/placements**
Returns available ad placements.

Response:
```json
{
  "isSuccessful": true,
  "data": [{
    "id": "uuid",
    "adGenId": "category-only",
    "displayName": "Category",
    "catalogIds": ["uuid", ...],
    "campaignTypes": ["PRODUCT"],
    "campaignTarget": "CATEGORY_ONLY"
  }]
}
```

### Reports

**POST /report-v2/generate-report**

Request:
```json
{
  "startInclusive": "2025-01-01T00:00:00Z",
  "endExclusive": "2025-04-01T00:00:00Z",
  "periodSeconds": 2592000,
  "filters": {
    "campaignTeamIds": ["{teamId}"]
  },
  "reportRequesterTeamId": "{teamId}",
  "measures": [
    "MeasureValidImpressionCount",
    "MeasureValidClickCount",
    "MeasureValidAdCostSum",
    "MeasureSaleRevenueSum_Divide_ValidAdCostSum"
  ]
}
```

Response:
```json
{
  "bucketedMeasureSummaries": [{
    "bucketStart": "2025-01-01T00:00:00Z",
    "bucketLengthSeconds": 2592000,
    "overallMeasures": [
      {"measure": "MeasureValidImpressionCount", "measuredValue": 463238},
      {"measure": "MeasureValidClickCount", "measuredValue": 9647},
      {"measure": "MeasureValidAdCostSum", "measuredValue": 175637.81}
    ],
    "dimensionalMeasures": []
  }]
}
```

### Available Measures

| Measure Name | Maps To | Description |
|---|---|---|
| MeasureValidImpressionCount | Impressions | Valid ad impressions |
| MeasureValidClickCount | Clicks | Valid ad clicks |
| MeasureValidAdCostSum | TotalSpend | Total ad spend |
| MeasureSaleRevenueSum_Divide_ValidAdCostSum | ROAS | Return on ad spend |
| MeasureValidClickCount_Divide_ValidImpressionCount | CTR | Click-through rate |
| MeasureValidAdCostSum_Divide_ValidClickCount | CPC | Cost per click |
| MeasureValidAdCostSum_Divide_ValidImpressionCount | CPM | Cost per impression |
| MeasureSaleRevenueSum | TotalRevenue | Total sales revenue |
| MeasureSaleCount | Purchases/Conversions | Number of sales |
| MeasureConversionCount | ConversionRate | Conversion count |
| MeasureConversionCount_Divide_ValidClickCount | ConversionRate | Conversion rate |
| MeasureValidAdCostSum_Divide_SaleCount | CPA | Cost per acquisition |
| MeasurePositionAverage | AveragePosition | Average ad position |
| MeasureProductCodeCountdistinct | ActiveProducts | Active product count |
| MeasureValidAdRevenueSum | TotalAdRevenue | Total ad revenue |
| MeasureValidAdRevenueSum_Divide_ValidClickCount | RevenuePerClick | Revenue per click |
| MeasureInvalidImpressionCount | InvalidImpressions | Invalid impressions |
| MeasureInvalidClickCount | InvalidClicks | Invalid clicks |

### Campaigns

**GET /campaign-v2/campaigns**
List campaigns. Needs teamId context (exact parameter TBD, returns GRPC error currently).

### All Known Endpoints

```
user/get-current-user
team/info?teamId={id}
team/get-teams
team/get-all-managed-team-ids-for-retailer
team/getPublicTeamDetails
team/get-users-for-team
team/get-team-invitations
catalog-v2/placements
campaign-v2/campaigns
campaign-v2/custom-field-configurations
report-v2/generate-report
report
report/request-report
report/dm-product-report
wallet/all
namespace-v2/namespaces-public/{namespace}
theme-v2/themes/{themeId}
okta/config?namespace={namespace}
```

## MetricTypeEnum to Measure Mapping

```
Impressions     -> MeasureValidImpressionCount
Clicks          -> MeasureValidClickCount
TotalSpend      -> MeasureValidAdCostSum
ReturnOnAdSpend -> MeasureSaleRevenueSum_Divide_ValidAdCostSum
ClickThroughRate -> MeasureValidClickCount_Divide_ValidImpressionCount
CostPerClick    -> MeasureValidAdCostSum_Divide_ValidClickCount
CostPerImpression -> MeasureValidAdCostSum_Divide_ValidImpressionCount
TotalRevenue    -> MeasureValidAdRevenueSum
TotalSalesValue -> MeasureSaleRevenueSum
Purchases       -> MeasureSaleCount
ConversionRate  -> MeasureConversionCount_Divide_ValidClickCount
CostPerAcquisition -> MeasureValidAdCostSum_Divide_SaleCount
ActiveProducts  -> MeasureProductCodeCountdistinct
AveragePosition -> MeasurePositionAverage
RevenuePerClick -> MeasureValidAdRevenueSum_Divide_ValidClickCount
```
