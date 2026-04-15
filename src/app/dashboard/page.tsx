"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { storage } from "@/lib/storage";
import type { TeamWithName, Campaign, Wallet } from "@/lib/citrusad/types";
import type {
  TeamOptConfig,
  DailyReport,
  AIAnalysisResponse,
  Recommendation,
  Alert,
  CampaignAnalysis,
  ScoreColor,
  DailyMetrics,
  CountryFilter,
  CurrencyDisplay,
} from "@/lib/optimization/types";
import { DEFAULT_OPT_CONFIG } from "@/lib/optimization/types";

type ViewState = "loading" | "idle" | "fetching" | "ready" | "error";

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamWithName[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<TeamWithName | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => formatDate((() => { const d = new Date(); d.setDate(d.getDate() - 14); return d; })()));
  const [dateTo, setDateTo] = useState(() => formatDate((() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })()));
  const [country, setCountry] = useState<CountryFilter>("all");
  const [currencyDisplay, setCurrencyDisplay] = useState<CurrencyDisplay>("CZK");
  const [optConfig, setOptConfig] = useState<TeamOptConfig>(DEFAULT_OPT_CONFIG);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResponse | null>(null);

  // Login
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  function handleLogout() {
    storage.clearToken();
    setToken(null);
    setTeams([]);
    setState("idle");
    setReport(null);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      storage.setToken(data.accessToken);
      setToken(data.accessToken);
      setFavorites(storage.getFavoriteTeams());
      setState("idle");
    } catch { setError("Přihlášení se nezdařilo."); }
    finally { setLoginLoading(false); }
  }

  useEffect(() => {
    const saved = storage.getToken();
    if (!saved) { setState("idle"); return; }
    setToken(saved);
    setFavorites(storage.getFavoriteTeams());
    setState("idle");
  }, []);

  const loadTeams = useCallback(async (t: string) => {
    try {
      const res = await fetch("/api/reports?action=teams", { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      setTeams(data.teams || []);
    } catch { setError("Nepodařilo se načíst klienty"); }
  }, []);

  useEffect(() => { if (token) loadTeams(token); }, [token, loadTeams]);

  useEffect(() => {
    if (!token || !selectedTeam) { setCampaigns([]); setWallets([]); return; }
    setFiltersLoading(true);
    Promise.all([
      fetch(`/api/reports?action=campaigns&teamId=${selectedTeam.id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      fetch(`/api/reports?action=wallets&teamId=${selectedTeam.id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
    ])
      .then(([c, w]) => { setCampaigns(c.campaigns || []); setWallets(w.wallets || []); })
      .catch(() => {})
      .finally(() => setFiltersLoading(false));
  }, [token, selectedTeam]);

  useEffect(() => {
    if (selectedTeam) {
      setOptConfig(storage.getTeamOptConfig(selectedTeam.id));
      setReport(null); setAiAnalysis(null); setSelectedCampaignIds([]); setSelectedWalletId("");
    }
  }, [selectedTeam]);

  const fetchReport = useCallback(async () => {
    if (!token || !selectedTeam) return;
    setState("fetching"); setError(null); setAiAnalysis(null);
    try {
      const configStr = encodeURIComponent(JSON.stringify(optConfig));
      const cp = selectedCampaignIds.length > 0 ? `&campaignIds=${selectedCampaignIds.join(",")}` : "";
      const res = await fetch(
        `/api/optimization?action=daily-report&teamId=${selectedTeam.id}&teamName=${encodeURIComponent(selectedTeam.name)}&dateFrom=${dateFrom}&dateTo=${dateTo}&country=${country}&currency=${currencyDisplay}&config=${configStr}${cp}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReport(data as DailyReport);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení reportu selhalo");
      setState("error");
    }
  }, [token, selectedTeam, optConfig, dateFrom, dateTo, selectedCampaignIds, country, currencyDisplay]);

  function setPresetRange(days: number) {
    const to = new Date(); to.setDate(to.getDate() - 1);
    const from = new Date(); from.setDate(from.getDate() - days);
    setDateFrom(formatDate(from)); setDateTo(formatDate(to));
  }

  function toggleCampaign(id: string) {
    setSelectedCampaignIds((p) => p.includes(id) ? p.filter((c) => c !== id) : [...p, id]);
  }

  async function requestAiAnalysis() {
    if (!report) return;
    setAiLoading(true);
    try {
      const settings = storage.getSettings();
      const res = await fetch("/api/optimization", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai-analysis", apiKey: settings.anthropicApiKey || undefined, model: settings.model, report }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiAnalysis(data as AIAnalysisResponse);
    } catch (err) { setError(err instanceof Error ? err.message : "AI analýza selhala"); }
    finally { setAiLoading(false); }
  }

  const sortedTeams = [...teams].sort((a, b) => {
    const af = favorites.includes(a.id) ? 0 : 1;
    const bf = favorites.includes(b.id) ? 0 : 1;
    return af !== bf ? af - bf : a.name.localeCompare(b.name);
  });

  const CC: Record<string, string> = { CZK: "CZ", EUR: "SK", HUF: "HU" };
  const activeWallets = wallets.filter((w) => !w.archived);
  const activeCampaigns = campaigns.filter((c) => {
    if (c.activeState !== "ACTIVE" && c.activeState !== "PAUSED") return false;
    if (country !== "all" && CC[c.currencyCode || "CZK"] !== country) return false;
    if (selectedWalletId && c.walletId !== selectedWalletId) return false;
    return true;
  });

  if (state === "loading") return (
    <div className="min-h-screen flex items-center justify-center bg-muted">
      <div className="spinner" />
    </div>
  );

  // ── Login screen ──
  if (!token) {
    return (
      <div className="min-h-screen bg-muted">
        <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-black/5">
          <div className="max-w-7xl mx-auto px-6 h-12 flex items-center">
            <span className="font-semibold text-[15px] tracking-tight text-[#1d1d1f]">alzaAds</span>
            <span className="text-[13px] text-[#86868b] font-normal ml-2">Brain</span>
          </div>
        </header>
        <main className="max-w-[360px] mx-auto px-6 mt-24">
          <div className="text-center mb-8">
            <h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">alzaAds Brain</h1>
            <p className="text-[15px] text-[#86868b] mt-2">Přihlaste se svým účtem</p>
          </div>
          {error && (
            <div className="card px-5 py-3 mb-6 flex items-center justify-between border-l-4 border-l-red">
              <p className="text-[13px] text-red">{error}</p>
              <button onClick={() => setError(null)} className="text-[#86868b] hover:text-[#1d1d1f] text-lg leading-none">&times;</button>
            </div>
          )}
          <div className="card p-8">
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">Email</label>
                <input type="email" value={username} onChange={(e) => setUsername(e.target.value)} required
                  className="w-full h-11 bg-[#f5f5f7] border-0 rounded-xl px-4 text-[15px] text-[#1d1d1f] placeholder:text-[#86868b] focus:ring-2 focus:ring-[#0071e3] outline-none"
                  placeholder="vas@email.cz" />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">Heslo</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  className="w-full h-11 bg-[#f5f5f7] border-0 rounded-xl px-4 text-[15px] text-[#1d1d1f] placeholder:text-[#86868b] focus:ring-2 focus:ring-[#0071e3] outline-none" />
              </div>
              <button type="submit" disabled={loginLoading}
                className="w-full h-11 bg-[#0071e3] text-white text-[15px] font-medium rounded-xl hover:bg-[#0077ed] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform">
                {loginLoading ? "Přihlašování..." : "Přihlásit se"}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // ── Authenticated dashboard ──
  return (
    <div className="min-h-screen bg-muted">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-black/5">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px] tracking-tight text-[#1d1d1f]">alzaAds</span>
            <span className="text-[13px] text-[#86868b] font-normal">Brain</span>
            <span className="text-[#d2d2d7] mx-3">|</span>
            <a href="/overview" className="text-[13px] text-[#86868b] hover:text-[#1d1d1f]">Overview</a>
            <span className="text-[13px] font-medium text-[#1d1d1f]">Daily Report</span>
          </div>
          <button onClick={handleLogout} className="text-[13px] text-[#86868b] hover:text-[#1d1d1f]">
            Odhlásit
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Error */}
        {error && (
          <div className="card px-5 py-3 mb-6 flex items-center justify-between border-l-4 border-l-red">
            <p className="text-[13px] text-red">{error}</p>
            <button onClick={() => setError(null)} className="text-[#86868b] hover:text-[#1d1d1f] text-lg leading-none">&times;</button>
          </div>
        )}

        {/* ── Filters ── */}
        <div className="card p-6 mb-8">
          <div className="space-y-5">
            {/* Team + Date */}
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[220px]">
                <Label>Klient</Label>
                <select value={selectedTeam?.id || ""}
                  onChange={(e) => { const t = teams.find((t) => t.id === e.target.value); setSelectedTeam(t || null); }}
                  className="w-full h-9 bg-muted border-0 rounded-lg px-3 text-[13px] text-[#1d1d1f] focus:ring-2 focus:ring-[#0071e3] outline-none">
                  <option value="">Vyberte klienta...</option>
                  {sortedTeams.map((t) => (
                    <option key={t.id} value={t.id}>{favorites.includes(t.id) ? "★ " : ""}{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Od</Label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 bg-muted border-0 rounded-lg px-3 text-[13px] focus:ring-2 focus:ring-[#0071e3] outline-none" />
              </div>
              <div>
                <Label>Do</Label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 bg-muted border-0 rounded-lg px-3 text-[13px] focus:ring-2 focus:ring-[#0071e3] outline-none" />
              </div>
              <div className="seg-group h-9 items-center">
                {[{ l: "7D", d: 7 }, { l: "14D", d: 14 }, { l: "30D", d: 30 }, { l: "90D", d: 90 }].map(({ l, d }) => (
                  <button key={l} onClick={() => setPresetRange(d)} className="seg-btn !py-0 h-7">{l}</button>
                ))}
              </div>
            </div>

            {/* Country + Currency */}
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <Label>Země</Label>
                <div className="seg-group">
                  {([["all","Vše"],["CZ","CZ"],["SK","SK"],["HU","HU"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => { setCountry(v as CountryFilter); setSelectedCampaignIds([]); if (v === "all") setCurrencyDisplay("CZK"); }}
                      className={`seg-btn ${country === v ? "active" : ""}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Měna</Label>
                <div className="seg-group">
                  <button onClick={() => setCurrencyDisplay("CZK")} className={`seg-btn ${currencyDisplay === "CZK" ? "active" : ""}`}>CZK</button>
                  <button onClick={() => setCurrencyDisplay("local")} disabled={country === "all"}
                    className={`seg-btn ${currencyDisplay === "local" ? "active" : ""} ${country === "all" ? "opacity-30 cursor-not-allowed" : ""}`}>
                    {country === "SK" ? "EUR" : country === "HU" ? "HUF" : "Lokální"}
                  </button>
                </div>
              </div>
              {selectedTeam && activeWallets.length > 0 && (
                <div>
                  <Label>Peněženka</Label>
                  <select value={selectedWalletId}
                    onChange={(e) => { setSelectedWalletId(e.target.value); setSelectedCampaignIds([]); }}
                    className="h-9 bg-muted border-0 rounded-lg px-3 text-[13px] focus:ring-2 focus:ring-[#0071e3] outline-none">
                    <option value="">Všechny</option>
                    {activeWallets.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}{w.availableBalance != null ? ` (${w.availableBalance.toLocaleString("cs-CZ")} ${w.currencyCode || "CZK"})` : ""}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Campaigns */}
            {selectedTeam && activeCampaigns.length > 0 && !filtersLoading && (
              <div>
                <Label>
                  Kampaně
                  {selectedCampaignIds.length > 0
                    ? <span className="text-[#0071e3] ml-1">({selectedCampaignIds.length})</span>
                    : <span className="text-[#86868b] font-normal ml-1">vše ({activeCampaigns.length})</span>}
                </Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {activeCampaigns.map((c) => {
                    const active = selectedCampaignIds.includes(c.id);
                    return (
                      <button key={c.id} onClick={() => toggleCampaign(c.id)}
                        className={`pill ${active ? "active" : ""}`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${c.activeState === "ACTIVE" ? "bg-green" : "bg-[#86868b]"}`} />
                        {c.name}
                        <span className="ml-1 opacity-50 text-[11px]">{CC[c.currencyCode || "CZK"] || ""}</span>
                      </button>
                    );
                  })}
                  {selectedCampaignIds.length > 0 && (
                    <button onClick={() => setSelectedCampaignIds([])} className="text-[12px] text-[#0071e3] hover:underline px-2 self-center">Zrušit</button>
                  )}
                </div>
              </div>
            )}

            {/* Action */}
            <button onClick={() => fetchReport()} disabled={!selectedTeam || state === "fetching"}
              className="h-10 px-8 rounded-full bg-[#0071e3] text-white text-[14px] font-medium hover:bg-[#0077ed] disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98] transition-transform">
              {state === "fetching" ? "Načítání..." : "Načíst report"}
            </button>
          </div>
        </div>

        {/* Loading */}
        {state === "fetching" && (
          <div className="flex flex-col items-center py-24">
            <div className="spinner mb-5" />
            <p className="text-[15px] font-medium text-[#1d1d1f]">Načítání reportu</p>
            <p className="text-[13px] text-[#86868b] mt-1">Dotazuji BigQuery...</p>
          </div>
        )}

        {/* Empty */}
        {(state === "idle" || state === "error") && !report && (
          <div className="text-center py-24">
            <p className="text-[17px] font-medium text-[#86868b]">Vyberte klienta a období</p>
          </div>
        )}

        {/* ── Report ── */}
        {report && state !== "fetching" && (
          <div className="space-y-8">
            {/* Alerts */}
            {report.alerts.length > 0 && (
              <div className="space-y-3">
                {report.alerts.map((a, i) => (
                  <div key={i} className={`card px-5 py-4 border-l-4 ${a.severity === "high" ? "border-l-red" : a.severity === "medium" ? "border-l-orange" : "border-l-[#0071e3]"}`}>
                    <p className="text-[14px] text-[#1d1d1f]">{a.message}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ── Overview ── */}
            <div className="card p-7">
              <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Přehled</h2>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-5">
                <ScoreBadge score={report.score.score} color={report.score.color} breakdown={report.score.breakdown} />
                <Metric label="Spend" value={fmt(report.yesterday.spend)} unit={`${report.displayCurrency}/den`} delta={report.deltas.spend} />
                <Metric label="Revenue" value={fmt(report.yesterday.revenue)} unit={`${report.displayCurrency}/den`} delta={report.deltas.revenue} />
                <Metric label="ROAS" value={report.yesterday.roas.toFixed(2)} unit="x" delta={report.deltas.roas} />
                {(() => {
                  const a = report.attribution.yesterday;
                  const avg = report.attribution.weekAvg;
                  if (!a) return <Metric label="Enhanced ROAS" value="—" />;
                  const e = a.spend > 0 ? (a.directRevenue + a.haloRevenue + a.viewThroughRevenue) / a.spend : 0;
                  const ea = avg && avg.spend > 0 ? (avg.directRevenue + avg.haloRevenue + avg.viewThroughRevenue) / avg.spend : 0;
                  return <Metric label="Enhanced ROAS" value={e.toFixed(2)} unit="x" delta={ea > 0 ? Math.round(((e - ea) / ea) * 1000) / 10 : 0} />;
                })()}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Metric label="Imprese" value={fmtInt(report.yesterday.impressions)} delta={report.deltas.impressions} small />
                <Metric label="Kliky" value={fmtInt(report.yesterday.clicks)} delta={report.deltas.clicks} small />
                <Metric label="CTR" value={(report.yesterday.ctr * 100).toFixed(2)} unit="%" delta={report.deltas.ctr} small />
                <Metric label="CPC" value={report.yesterday.cpc.toFixed(2)} unit={report.displayCurrency} delta={report.deltas.cpc} small invertDelta />
              </div>
            </div>

            {/* ── Trend ── */}
            {report.dailyTrend.length > 1 && (
              <div className="card p-7">
                <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Denní trend</h2>
                <TrendChart data={report.dailyTrend} currency={report.displayCurrency} />
              </div>
            )}

            {/* ── Attribution ── */}
            {report.attribution.yesterday && (
              <div className="card p-7">
                <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Atribuce</h2>
                {(() => {
                  const a = report.attribution.yesterday;
                  const baseRevenue = report.yesterday.revenue * (report.dailyTrend.length || 1);
                  const baseSpend = report.yesterday.spend * (report.dailyTrend.length || 1);
                  const enhancedRevenue = a.directRevenue + a.haloRevenue + a.viewThroughRevenue;
                  const enhancedSpend = a.spend;
                  const baseRoas = baseSpend > 0 ? baseRevenue / baseSpend : 0;
                  const enhancedRoas = enhancedSpend > 0 ? enhancedRevenue / enhancedSpend : 0;
                  const cur = report.displayCurrency;
                  return (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                      <div>
                        <p className="text-[13px] text-[#86868b] mb-1.5">Base ROAS</p>
                        <p className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">{baseRoas.toFixed(2)}<span className="text-[14px] font-normal text-[#86868b]">x</span></p>
                      </div>
                      <div>
                        <p className="text-[13px] text-[#86868b] mb-1.5">Base Revenue</p>
                        <p className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">{fmt(baseRevenue)} <span className="text-[14px] font-normal text-[#86868b]">{cur}</span></p>
                      </div>
                      <div>
                        <p className="text-[13px] text-[#86868b] mb-1.5">Enhanced ROAS</p>
                        <p className="text-[22px] font-semibold tracking-tight text-green">{enhancedRoas.toFixed(2)}<span className="text-[14px] font-normal text-[#86868b]">x</span></p>
                      </div>
                      <div>
                        <p className="text-[13px] text-[#86868b] mb-1.5">Enhanced Revenue</p>
                        <p className="text-[22px] font-semibold tracking-tight text-green">{fmt(enhancedRevenue)} <span className="text-[14px] font-normal text-[#86868b]">{cur}</span></p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── Recommendations ── */}
            {report.recommendations.length > 0 && (
              <div className="card p-7">
                <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Doporučení <span className="text-[#86868b] font-normal">({report.recommendations.length})</span></h2>
                <div className="space-y-0">
                  {report.recommendations.map((rec, i) => <RecRow key={i} rec={rec} />)}
                </div>
              </div>
            )}

            {/* ── Campaigns ── */}
            <div className="card p-7">
              <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Kampaně <span className="text-[#86868b] font-normal">({report.campaigns.length})</span></h2>
              <div className="space-y-4">
                {report.campaigns.map((c) => (
                  <CampaignCard key={c.campaignId} campaign={c} targetRoas={optConfig.targetRoas / 100}
                    displayCurrency={report.displayCurrency} walletName={wallets.find((w) => w.id === c.walletId)?.name} />
                ))}
              </div>
            </div>

            {/* ── Competition ── */}
            {report.categoryCompetition.length > 0 && (
              <div className="card p-7 overflow-x-auto">
                <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Konkurence v kategoriích</h2>
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="text-[13px] text-[#86868b] border-b border-[#e5e5ea]">
                      <th className="pb-3 pr-6 text-left font-medium">Kategorie</th>
                      <th className="pb-3 pr-6 text-right font-medium">Konkurenti</th>
                      <th className="pb-3 pr-6 text-right font-medium">Tržní CPC</th>
                      <th className="pb-3 pr-6 text-right font-medium">Imprese</th>
                      <th className="pb-3 text-right font-medium">Click share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.categoryCompetition.slice(0, 20).map((cat) => (
                      <tr key={cat.category} className="border-b border-[#f5f5f7] last:border-0 hover:bg-muted/50">
                        <td className="py-3.5 pr-6 truncate max-w-[200px] text-[#1d1d1f]" title={cat.category}>{cat.category}</td>
                        <td className="py-3.5 pr-6 text-right text-[#86868b]">{cat.competitors}</td>
                        <td className="py-3.5 pr-6 text-right text-[#1d1d1f]">{cat.marketCpc.toFixed(2)}</td>
                        <td className="py-3.5 pr-6 text-right text-[#86868b]">{fmtInt(cat.totalImpressions)}</td>
                        <td className="py-3.5 text-right font-medium text-[#1d1d1f]">{(cat.clickShare * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── AI Analysis ── */}
            <div className="card p-7">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[17px] font-semibold text-[#1d1d1f]">AI Analýza</h2>
                {!aiAnalysis && (
                  <button onClick={requestAiAnalysis} disabled={aiLoading}
                    className="h-8 px-5 rounded-full bg-purple text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-40 active:scale-[0.98] transition-transform">
                    {aiLoading ? "Generuji..." : "Spustit analýzu"}
                  </button>
                )}
              </div>
              {aiLoading && (
                <div className="flex items-center gap-3 py-6">
                  <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                  <span className="text-[13px] text-[#86868b]">Claude analyzuje data...</span>
                </div>
              )}
              {aiAnalysis && (
                <div className="space-y-5">
                  <p className="text-[14px] leading-relaxed text-[#1d1d1f]">{aiAnalysis.summary}</p>
                  {aiAnalysis.prioritizedActions.length > 0 && (
                    <div>
                      <h4 className="text-[13px] font-semibold text-[#1d1d1f] mb-3">Prioritizované akce</h4>
                      <div className="space-y-3">
                        {aiAnalysis.prioritizedActions.map((a, i) => (
                          <div key={i} className="flex gap-3 items-start">
                            <span className="shrink-0 w-6 h-6 rounded-full bg-purple/10 text-purple text-[12px] font-bold flex items-center justify-center">{a.priority}</span>
                            <div>
                              <p className="text-[13px] text-[#1d1d1f]">{a.action}</p>
                              <p className="text-[12px] text-[#86868b] mt-0.5">Dopad: {a.expectedImpact} &middot; {a.effort === "low" ? "Snadné" : a.effort === "medium" ? "Střední" : "Náročné"}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiAnalysis.riskAssessment && (
                    <div className="bg-red/5 rounded-xl p-4">
                      <h4 className="text-[13px] font-semibold text-red mb-1">Rizika</h4>
                      <p className="text-[13px] text-[#1d1d1f]">{aiAnalysis.riskAssessment}</p>
                    </div>
                  )}
                  {(aiAnalysis.categoryRecommendations.length > 0 || aiAnalysis.bidRecommendations.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {aiAnalysis.categoryRecommendations.length > 0 && (
                        <div className="bg-muted rounded-xl p-4">
                          <h4 className="text-[13px] font-semibold text-[#1d1d1f] mb-2">Kategorie</h4>
                          <ul className="space-y-1.5">{aiAnalysis.categoryRecommendations.map((r, i) => <li key={i} className="text-[13px] text-[#424245] pl-3 relative before:absolute before:left-0 before:top-2 before:w-1 before:h-1 before:bg-[#86868b] before:rounded-full">{r}</li>)}</ul>
                        </div>
                      )}
                      {aiAnalysis.bidRecommendations.length > 0 && (
                        <div className="bg-muted rounded-xl p-4">
                          <h4 className="text-[13px] font-semibold text-[#1d1d1f] mb-2">Bidy</h4>
                          <ul className="space-y-1.5">{aiAnalysis.bidRecommendations.map((r, i) => <li key={i} className="text-[13px] text-[#424245] pl-3 relative before:absolute before:left-0 before:top-2 before:w-1 before:h-1 before:bg-[#86868b] before:rounded-full">{r}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {!aiAnalysis && !aiLoading && (
                <p className="text-[13px] text-[#86868b]">Analyzuje data a vytvoří prioritizovaná doporučení.</p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] font-medium text-[#86868b] mb-1.5">{children}</p>;
}

function ScoreBadge({ score, color, breakdown }: {
  score: number; color: ScoreColor;
  breakdown: { roasScore: number; budgetScore: number; trendScore: number; issueScore: number };
}) {
  const ring: Record<ScoreColor, string> = {
    green: "from-green to-green/60",
    orange: "from-orange to-orange/60",
    red: "from-red to-red/60",
  };
  const pct = score / 100;
  const circ = 2 * Math.PI * 38;
  return (
    <div className="bg-muted/60 rounded-2xl p-5 flex flex-col items-center justify-center">
      <div className="relative w-20 h-20">
        <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90">
          <circle cx="44" cy="44" r="38" fill="none" stroke="#f5f5f7" strokeWidth="5" />
          <circle cx="44" cy="44" r="38" fill="none" strokeWidth="5" strokeLinecap="round"
            stroke={color === "green" ? "#34C759" : color === "orange" ? "#FF9500" : "#FF3B30"}
            strokeDasharray={`${pct * circ} ${circ}`} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[22px] font-bold text-[#1d1d1f]">{score}</span>
        </div>
      </div>
      <p className="text-[12px] text-[#86868b] mt-2">Skóre</p>
    </div>
  );
}

function Metric({ label, value, unit, delta, small, invertDelta }: {
  label: string; value: string; unit?: string; delta?: number; small?: boolean; invertDelta?: boolean;
}) {
  const pos = invertDelta ? (delta ?? 0) < 0 : (delta ?? 0) > 0;
  const dcol = delta === 0 || delta === undefined ? "text-[#86868b]" : pos ? "text-green" : "text-red";
  return (
    <div className={`bg-muted/60 rounded-2xl ${small ? "p-4" : "p-5"}`}>
      <p className="text-[13px] text-[#86868b] mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={`font-semibold tracking-tight text-[#1d1d1f] ${small ? "text-[18px]" : "text-[24px]"}`}>{value}</span>
        {unit && <span className="text-[12px] text-[#86868b]">{unit}</span>}
      </div>
      {delta !== undefined && (
        <p className={`text-[12px] mt-1 ${dcol}`}>
          {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
        </p>
      )}
    </div>
  );
}

function RecRow({ rec }: { rec: Recommendation }) {
  const labels: Record<string, string> = {
    category_remove: "Odebrat kategorii", category_add: "Přidat kategorii",
    bid_increase: "Zvýšit bid", bid_decrease: "Snížit bid",
    product_remove: "Odebrat produkt", click_share_drop: "Pokles click share",
  };
  const dot = rec.severity === "high" ? "bg-red" : rec.severity === "medium" ? "bg-orange" : "bg-[#86868b]";
  return (
    <div className="flex items-start gap-3 py-3 border-b border-[#f5f5f7] last:border-0">
      <span className={`shrink-0 w-2 h-2 rounded-full mt-1.5 ${dot}`} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[#1d1d1f]">{rec.campaignName}</span>
          {rec.category && <span className="text-[12px] text-[#86868b]">{rec.category}</span>}
          <span className="text-[11px] text-[#0071e3] bg-[#0071e3]/8 px-2 py-0.5 rounded-full">{labels[rec.type] || rec.type}</span>
        </div>
        <p className="text-[12px] text-[#86868b] mt-0.5">{rec.reason}</p>
      </div>
    </div>
  );
}

function CampaignCard({ campaign, targetRoas, displayCurrency, walletName }: {
  campaign: CampaignAnalysis; targetRoas: number; displayCurrency: string; walletName?: string;
}) {
  const rc = campaign.roas >= targetRoas ? "text-green" : campaign.roas >= targetRoas * 0.7 ? "text-orange" : "text-red";
  const CC: Record<string, string> = { CZK: "CZ", EUR: "SK", HUF: "HU" };
  const cc = CC[campaign.currency] || "?";
  const s = campaign.setup || { maxCpc: 0, budget: 0, maxDailySpend: 0, categories: "", targetedCategories: "", promotedProductCount: 0, walletBalance: 0, walletDailyLimit: 0, walletCappedBalance: 0 };
  const cur = campaign.currency || "CZK";
  const cats = (s.targetedCategories || s.categories || "").split(",").map((c) => c.trim()).filter(Boolean);

  return (
    <div className="bg-muted/60 rounded-2xl p-5 transition-colors hover:bg-muted">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[10px] font-bold text-[#86868b] bg-muted rounded-md px-1.5 py-0.5 shrink-0">{cc}</span>
          <h4 className="text-[14px] font-semibold text-[#1d1d1f] truncate">{campaign.campaignName}</h4>
          <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${campaign.activeState === "ACTIVE" ? "bg-green" : "bg-[#86868b]"}`} />
        </div>
        <span className={`text-[20px] font-bold tracking-tight ${rc}`}>{campaign.roas.toFixed(2)}x</span>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-5 gap-4 mb-4">
        {[
          { l: "Spend", v: `${fmt(campaign.spend)} ${displayCurrency}` },
          { l: "Revenue", v: `${fmt(campaign.revenue)} ${displayCurrency}` },
          { l: "Imprese", v: fmtInt(campaign.impressions) },
          { l: "CTR", v: `${(campaign.ctr * 100).toFixed(2)}%` },
          { l: "CPC", v: `${campaign.cpc.toFixed(2)} ${displayCurrency}` },
        ].map(({ l, v }) => (
          <div key={l}>
            <p className="text-[11px] text-[#86868b]">{l}</p>
            <p className="text-[13px] font-medium text-[#1d1d1f]">{v}</p>
          </div>
        ))}
      </div>

      {/* Setup */}
      <div className="bg-white rounded-xl p-3.5 mb-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[12px]">
          {[
            { l: "Max CPC", v: s.maxCpc > 0 ? `${s.maxCpc.toFixed(2)} ${cur}` : null },
            { l: "Rozpočet", v: s.budget > 0 ? `${fmtInt(s.budget)} ${cur}` : null },
            { l: "Max denní", v: s.maxDailySpend > 0 ? `${fmtInt(s.maxDailySpend)} ${cur}` : null },
            { l: "Produkty", v: s.promotedProductCount > 0 ? `${s.promotedProductCount}` : null },
            { l: "Peněženka", v: walletName || null },
            { l: "Zůstatek", v: s.walletBalance > 0 ? `${fmtInt(s.walletBalance)} ${cur}` : null },
            { l: "Denní limit", v: s.walletDailyLimit > 0 ? `${fmtInt(s.walletDailyLimit)} ${cur}` : null },
          ].filter(({ v }) => v).map(({ l, v }) => (
            <div key={l} className="flex justify-between">
              <span className="text-[#86868b]">{l}</span>
              <span className="font-medium text-[#1d1d1f]">{v}</span>
            </div>
          ))}
        </div>
        {cats.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {cats.slice(0, 8).map((cat) => (
              <span key={cat} className="text-[11px] bg-white text-[#424245] px-2 py-0.5 rounded-full">{cat}</span>
            ))}
            {cats.length > 8 && <span className="text-[11px] text-[#86868b] self-center">+{cats.length - 8}</span>}
          </div>
        )}
      </div>

      {/* Recommendations */}
      {campaign.recommendations.length > 0 && (
        <div className="space-y-1.5">
          {campaign.recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-2 text-[12px]">
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${rec.severity === "high" ? "bg-red" : rec.severity === "medium" ? "bg-orange" : "bg-[#86868b]"}`} />
              <span className="text-[#424245]">{rec.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Chart ───────────────────────────────────────────────────────────────────

function TrendChart({ data, currency = "CZK" }: { data: DailyMetrics[]; currency?: string }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 760;
  const H = 240;
  const PAD = { top: 20, right: 20, bottom: 36, left: 60 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const maxVal = Math.max(...data.map((d) => Math.max(d.revenue, d.spend)), 1) * 1.1;

  function px(i: number) { return PAD.left + (data.length === 1 ? cW / 2 : (i / (data.length - 1)) * cW); }
  function py(v: number) { return PAD.top + cH - (v / maxVal) * cH; }

  function smooth(values: number[]): string {
    if (values.length < 2) return values.length === 1 ? `M${px(0)},${py(values[0])}` : "";
    const pts = values.map((v, i) => ({ x: px(i), y: py(v) }));
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], c = pts[i];
      const dx = c.x - p.x;
      d += ` C${(p.x + dx * 0.4).toFixed(1)},${p.y.toFixed(1)} ${(c.x - dx * 0.4).toFixed(1)},${c.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)}`;
    }
    return d;
  }

  function area(values: number[]): string {
    const p = smooth(values);
    if (!p) return "";
    return `${p} L${px(values.length - 1).toFixed(1)},${PAD.top + cH} L${px(0).toFixed(1)},${PAD.top + cH} Z`;
  }

  const yTicks: number[] = [];
  const step = niceStep(maxVal, 4);
  for (let v = 0; v <= maxVal; v += step) yTicks.push(v);
  const labelStep = Math.max(1, Math.floor(data.length / 7));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0, best = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(px(i) - svgX);
      if (d < best) { best = d; nearest = i; }
    }
    setHover(nearest);
  }

  const hd = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34C759" stopOpacity="0.20" />
            <stop offset="100%" stopColor="#34C759" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="gSpend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0071e3" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0071e3" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} y1={py(v)} x2={W - PAD.right} y2={py(v)} stroke="#e5e5ea" strokeWidth="0.5" />
            <text x={PAD.left - 10} y={py(v) + 4} textAnchor="end" fontSize="11" fill="#86868b" fontFamily="-apple-system, sans-serif">
              {v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : Math.round(v).toString()}
            </text>
          </g>
        ))}

        {/* Areas */}
        <path d={area(data.map((d) => d.revenue))} fill="url(#gRev)" />
        <path d={area(data.map((d) => d.spend))} fill="url(#gSpend)" />

        {/* Lines */}
        <path d={smooth(data.map((d) => d.revenue))} fill="none" stroke="#34C759" strokeWidth="2" strokeLinecap="round" />
        <path d={smooth(data.map((d) => d.spend))} fill="none" stroke="#0071e3" strokeWidth="2" strokeLinecap="round" opacity="0.7" />

        {/* Hover */}
        {hover !== null && (
          <>
            <line x1={px(hover)} y1={PAD.top} x2={px(hover)} y2={PAD.top + cH} stroke="#1d1d1f" strokeWidth="0.5" opacity="0.15" />
            <circle cx={px(hover)} cy={py(data[hover].revenue)} r="4.5" fill="white" stroke="#34C759" strokeWidth="2" />
            <circle cx={px(hover)} cy={py(data[hover].spend)} r="4" fill="white" stroke="#0071e3" strokeWidth="2" />
          </>
        )}

        {/* Subtle dots */}
        {data.map((d, i) => hover === null || hover === i ? null : (
          <g key={i} opacity="0.3">
            <circle cx={px(i)} cy={py(d.revenue)} r="1.5" fill="#34C759" />
            <circle cx={px(i)} cy={py(d.spend)} r="1.5" fill="#0071e3" />
          </g>
        ))}

        {/* X labels */}
        {data.map((d, i) => {
          if (i % labelStep !== 0 && i !== data.length - 1) return null;
          return (
            <text key={i} x={px(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="#86868b" fontFamily="-apple-system, sans-serif">
              {d.date.slice(5).replace("-", "/")}
            </text>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hover !== null && hd && (
        <div className="absolute pointer-events-none z-10 bg-white/95 backdrop-blur-lg shadow-lg rounded-xl border border-black/5 px-4 py-3"
          style={{ left: `${(px(hover) / W) * 100}%`, top: 4, transform: "translateX(-50%)" }}>
          <p className="text-[12px] font-semibold text-[#1d1d1f] mb-1.5">{hd.date}</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="w-2 h-2 rounded-full bg-green" />
              <span className="text-[#86868b] w-16">Revenue</span>
              <span className="font-medium text-[#1d1d1f]">{fmt(hd.revenue)} {currency}</span>
            </div>
            <div className="flex items-center gap-2 text-[12px]">
              <span className="w-2 h-2 rounded-full bg-[#0071e3]" />
              <span className="text-[#86868b] w-16">Spend</span>
              <span className="font-medium text-[#1d1d1f]">{fmt(hd.spend)} {currency}</span>
            </div>
            <div className="flex items-center gap-2 text-[12px]">
              <span className="w-2 h-2 rounded-full bg-purple" />
              <span className="text-[#86868b] w-16">ROAS</span>
              <span className="font-medium text-[#1d1d1f]">{hd.spend > 0 ? (hd.revenue / hd.spend).toFixed(2) : "—"}x</span>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-5 mt-3 justify-center">
        <div className="flex items-center gap-1.5 text-[12px] text-[#86868b]">
          <span className="w-3 h-[2px] bg-green rounded-full" /> Revenue
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-[#86868b]">
          <span className="w-3 h-[2px] bg-[#0071e3] rounded-full opacity-70" /> Spend
        </div>
      </div>
    </div>
  );
}

function niceStep(max: number, ticks: number): number {
  const rough = max / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const nice = n <= 1.5 ? 1 : n <= 3 ? 2 : n <= 7 ? 5 : 10;
  return nice * pow;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 });
}

function fmtInt(n: number): string {
  return n.toLocaleString("cs-CZ");
}
