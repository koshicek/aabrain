import {
  CitrusAdUser,
  TeamInfo,
  Placement,
  ReportRequest,
  ReportResponse,
  ApiResponse,
  TeamWithName,
  Wallet,
  Campaign,
} from "./types";

const BASE_URL = "https://gateway.eu2.citrusad.com/v1";
const NAMESPACE = "alzaads";

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "citrus-namespace": NAMESPACE,
    "Content-Type": "application/json",
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok && res.status === 401) {
    throw new Error("SESSION_EXPIRED");
  }
  const data = await res.json();
  return data as T;
}

export async function getCurrentUser(token: string): Promise<CitrusAdUser> {
  const res = await fetch(`${BASE_URL}/user/get-current-user`, {
    headers: headers(token),
  });
  return handleResponse<CitrusAdUser>(res);
}

export async function getTeamInfo(
  token: string,
  teamId: string
): Promise<TeamInfo> {
  const res = await fetch(
    `${BASE_URL}/team/info?teamId=${encodeURIComponent(teamId)}`,
    { headers: headers(token) }
  );
  return handleResponse<TeamInfo>(res);
}

export async function getTeamNames(
  token: string,
  teamIds: string[]
): Promise<TeamWithName[]> {
  const batchSize = 20;
  const results: TeamWithName[] = [];

  for (let i = 0; i < teamIds.length; i += batchSize) {
    const batch = teamIds.slice(i, i + batchSize);
    const promises = batch.map(async (id) => {
      try {
        const info = await getTeamInfo(token, id);
        return { id, name: info.team?.name || "Unknown" };
      } catch {
        return { id, name: "Unknown" };
      }
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  return results.sort((a, b) => a.name.localeCompare(b.name, "cs"));
}

export async function getPlacements(
  token: string
): Promise<ApiResponse<Placement[]>> {
  const res = await fetch(`${BASE_URL}/catalog-v2/placements`, {
    headers: headers(token),
  });
  return handleResponse<ApiResponse<Placement[]>>(res);
}

export async function getWallets(
  token: string,
  teamId: string
): Promise<Wallet[]> {
  const res = await fetch(
    `${BASE_URL}/wallet/all?teamId=${encodeURIComponent(teamId)}`,
    { headers: headers(token) }
  );
  const data = await handleResponse<{ wallets?: Wallet[] } | Wallet[]>(res);
  if (Array.isArray(data)) return data;
  return data.wallets || [];
}

export async function getCampaigns(
  token: string,
  teamId: string
): Promise<Campaign[]> {
  const res = await fetch(
    `${BASE_URL}/campaign-v2/campaigns?teamId=${encodeURIComponent(teamId)}&pageSize=200`,
    { headers: headers(token) }
  );
  const data = await handleResponse<{
    isSuccessful?: boolean;
    data?: Campaign[];
  }>(res);
  return data.data || [];
}

export async function generateReport(
  token: string,
  request: ReportRequest
): Promise<ReportResponse> {
  const res = await fetch(`${BASE_URL}/report-v2/generate-report`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(request),
  });

  const data = await res.json();

  if (data.errorMessages?.length) {
    throw new Error(data.errorMessages[0].message);
  }

  return data as ReportResponse;
}
