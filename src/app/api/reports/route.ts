import { NextRequest, NextResponse } from "next/server";
import * as bq from "@/lib/citrusad/bigquery";
import { MeasureKey, MEASURES } from "@/lib/citrusad/types";

function getToken(req: NextRequest): string {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new Error("Missing authorization token");
  }
  return auth.slice(7);
}

export async function GET(req: NextRequest) {
  try {
    // Token still required for auth gating (platform API token)
    getToken(req);
    const action = req.nextUrl.searchParams.get("action");

    if (action === "teams") {
      const teams = await bq.getTeams();
      return NextResponse.json({ teams });
    }

    if (action === "wallets") {
      const teamId = req.nextUrl.searchParams.get("teamId");
      if (!teamId) {
        return NextResponse.json({ error: "teamId required" }, { status: 400 });
      }
      const wallets = await bq.getWallets(teamId);
      return NextResponse.json({ wallets });
    }

    if (action === "campaigns") {
      const teamId = req.nextUrl.searchParams.get("teamId");
      if (!teamId) {
        return NextResponse.json({ error: "teamId required" }, { status: 400 });
      }
      const campaigns = await bq.getCampaigns(teamId);
      return NextResponse.json({ campaigns });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    getToken(req);
    const body = await req.json();

    // Map the API measure names back to MeasureKeys
    const measureKeys: MeasureKey[] = (body.measures || []).map(
      (apiMeasure: string) => {
        const entry = Object.entries(MEASURES).find(
          ([, v]) => v === apiMeasure
        );
        return entry ? (entry[0] as MeasureKey) : null;
      }
    ).filter(Boolean);

    const buckets = await bq.generateReport({
      teamId:
        body.filters?.campaignTeamIds?.[0] || body.reportRequesterTeamId,
      dateFrom: body.startInclusive.split("T")[0],
      dateTo: body.endExclusive.split("T")[0],
      measures: measureKeys,
      campaignIds: body.filters?.campaignIds,
      walletId: body.filters?.walletId,
      periodSeconds: body.periodSeconds,
    });

    return NextResponse.json({ bucketedMeasureSummaries: buckets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
