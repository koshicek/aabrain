"use client";

import { useState, useEffect, useCallback } from "react";
import { storage } from "@/lib/storage";
import {
  MEASURES,
  CORE_MEASURES,
  EXTENDED_MEASURES,
  MeasureKey,
  ReportBucket,
  TeamWithName,
  Wallet,
  Campaign,
} from "@/lib/citrusad/types";
import { generatePptxReport } from "@/lib/reports/pptx-generator";
import {
  generateExcelReport,
  generateCsvReport,
} from "@/lib/reports/excel-generator";

type Step = "login" | "configure" | "generating" | "done";

export default function Home() {
  const [step, setStep] = useState<Step>("login");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Login
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Teams
  const [teams, setTeams] = useState<TeamWithName[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamWithName | null>(null);
  const [teamSearch, setTeamSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);

  // Wallets & Campaigns
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);
  const [filtersLoading, setFiltersLoading] = useState(false);

  // Config
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [selectedMeasures, setSelectedMeasures] =
    useState<MeasureKey[]>(CORE_MEASURES);

  // Generation
  const [progress, setProgress] = useState("");
  const [reportData, setReportData] = useState<ReportBucket[] | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    const saved = storage.getToken();
    if (saved) {
      setToken(saved);
      setStep("configure");
    }
    setFavorites(storage.getFavoriteTeams());
    setApiKey(storage.getSettings().anthropicApiKey);
  }, []);

  const loadTeams = useCallback(
    async (accessToken: string) => {
      if (teams.length > 0) return;
      setTeamsLoading(true);
      try {
        const res = await fetch("/api/reports?action=teams", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        const data = await res.json();
        setTeams(data.teams || []);
      } catch {
        setError("Nepodařilo se načíst klienty");
      } finally {
        setTeamsLoading(false);
      }
    },
    [teams.length]
  );

  useEffect(() => {
    if (token && step === "configure") {
      loadTeams(token);
    }
  }, [token, step, loadTeams]);

  // Load wallets and campaigns when team changes
  useEffect(() => {
    if (!token || !selectedTeam) {
      setWallets([]);
      setCampaigns([]);
      setSelectedWalletId("");
      setSelectedCampaignIds([]);
      return;
    }
    async function loadFilters() {
      setFiltersLoading(true);
      try {
        const [walletsRes, campaignsRes] = await Promise.all([
          fetch(
            `/api/reports?action=wallets&teamId=${selectedTeam!.id}`,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
          fetch(
            `/api/reports?action=campaigns&teamId=${selectedTeam!.id}`,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
        ]);
        const walletsData = await walletsRes.json();
        const campaignsData = await campaignsRes.json();
        setWallets(walletsData.wallets || []);
        setCampaigns(campaignsData.campaigns || []);
      } catch {
        // Non-critical, filters are optional
      } finally {
        setFiltersLoading(false);
      }
    }
    loadFilters();
  }, [token, selectedTeam]);

  function handleSessionExpired() {
    storage.clearToken();
    setToken(null);
    setStep("login");
    setError("Relace vypršela. Přihlaste se znovu.");
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
      if (data.error) {
        setError(data.error);
        return;
      }
      storage.setToken(data.accessToken);
      setToken(data.accessToken);
      setStep("configure");
    } catch {
      setError("Přihlášení se nezdařilo. Zkuste to znovu.");
    } finally {
      setLoginLoading(false);
    }
  }

  function toggleMeasure(key: MeasureKey) {
    setSelectedMeasures((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );
  }

  function toggleFavorite(teamId: string) {
    const newFavs = storage.toggleFavorite(teamId);
    setFavorites(newFavs);
  }

  function toggleCampaign(campaignId: string) {
    setSelectedCampaignIds((prev) =>
      prev.includes(campaignId)
        ? prev.filter((id) => id !== campaignId)
        : [...prev, campaignId]
    );
  }

  async function handleGenerateReport() {
    if (!token || !selectedTeam) return;
    setStep("generating");
    setError(null);

    try {
      setProgress("Načítání dat z AlzaAds...");
      const periodMs =
        new Date(dateTo).getTime() - new Date(dateFrom).getTime();
      const periodSeconds = Math.floor(periodMs / 1000);
      const monthSeconds = 30 * 24 * 60 * 60;
      const bucketPeriod =
        periodSeconds > monthSeconds * 2 ? monthSeconds : periodSeconds;

      const filters: Record<string, string[]> = {
        campaignTeamIds: [selectedTeam.id],
      };
      if (selectedCampaignIds.length > 0) {
        filters.campaignIds = selectedCampaignIds;
      }

      const reportRes = await fetch("/api/reports", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startInclusive: new Date(dateFrom).toISOString(),
          endExclusive: new Date(dateTo).toISOString(),
          periodSeconds: bucketPeriod,
          filters,
          reportRequesterTeamId: selectedTeam.id,
          measures: selectedMeasures.map((k) => MEASURES[k]),
        }),
      });

      if (reportRes.status === 401) {
        handleSessionExpired();
        return;
      }

      const reportJson = await reportRes.json();
      if (reportJson.error) {
        throw new Error(reportJson.error);
      }

      const buckets: ReportBucket[] =
        reportJson.bucketedMeasureSummaries || [];
      setReportData(buckets);

      let analysisText: string | null = null;
      const settings = storage.getSettings();
      if (settings.anthropicApiKey) {
        setProgress("Generování AI analýzy...");
        try {
          const dataForAnalysis = formatDataForAnalysis(
            buckets,
            selectedMeasures
          );
          const analyzeRes = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              data: dataForAnalysis,
              teamName: selectedTeam.name,
              dateRange: `${dateFrom} - ${dateTo}`,
              language: settings.language,
              apiKey: settings.anthropicApiKey,
              model: settings.model,
            }),
          });
          const analyzeJson = await analyzeRes.json();
          if (analyzeJson.analysis) {
            analysisText = analyzeJson.analysis;
            setAnalysis(analysisText);
          }
        } catch {
          // AI analýza je volitelná
        }
      }

      setProgress("Hotovo!");
      setStep("done");

      storage.addRecentReport({
        id: crypto.randomUUID(),
        teamId: selectedTeam.id,
        teamName: selectedTeam.name,
        dateFrom,
        dateTo,
        generatedAt: new Date().toISOString(),
        measures: selectedMeasures,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Generování reportu selhalo"
      );
      setStep("configure");
    }
  }

  async function downloadPptx() {
    if (!reportData || !selectedTeam) return;
    const pptx = generatePptxReport({
      teamName: selectedTeam.name,
      dateFrom,
      dateTo,
      buckets: reportData,
      measures: selectedMeasures,
      analysis: analysis || undefined,
    });
    await pptx.writeFile({
      fileName: `AlzaAds_${selectedTeam.name.replace(/\s+/g, "_")}_${dateFrom}_${dateTo}.pptx`,
    });
  }

  async function downloadExcel() {
    if (!reportData || !selectedTeam) return;
    const buffer = await generateExcelReport({
      teamName: selectedTeam.name,
      dateFrom,
      dateTo,
      buckets: reportData,
      measures: selectedMeasures,
      analysis: analysis || undefined,
    });
    const blob = new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AlzaAds_${selectedTeam.name.replace(/\s+/g, "_")}_${dateFrom}_${dateTo}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadCsv() {
    if (!reportData || !selectedTeam) return;
    const csv = generateCsvReport({
      teamName: selectedTeam.name,
      dateFrom,
      dateTo,
      buckets: reportData,
      measures: selectedMeasures,
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AlzaAds_${selectedTeam.name.replace(/\s+/g, "_")}_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatDataForAnalysis(
    buckets: ReportBucket[],
    measures: MeasureKey[]
  ): string {
    const lines: string[] = [];
    lines.push(["Period", ...measures].join(" | "));
    lines.push(["---", ...measures.map(() => "---")].join(" | "));
    for (const bucket of buckets) {
      const date = new Date(bucket.bucketStart).toISOString().split("T")[0];
      const measureMap: Record<string, number> = {};
      for (const m of bucket.overallMeasures) {
        measureMap[m.measure] = m.measuredValue;
      }
      const values = measures.map((k) => {
        const v = measureMap[MEASURES[k]] || 0;
        return v % 1 !== 0 ? v.toFixed(2) : v.toString();
      });
      lines.push([date, ...values].join(" | "));
    }
    return lines.join("\n");
  }

  const filteredTeams = teams.filter((t) => {
    if (!teamSearch) return true;
    return t.name.toLowerCase().includes(teamSearch.toLowerCase());
  });

  const favoriteTeams = filteredTeams.filter((t) => favorites.includes(t.id));
  const otherTeams = filteredTeams.filter((t) => !favorites.includes(t.id));

  // Filter campaigns by wallet
  const filteredCampaigns = selectedWalletId
    ? campaigns.filter((c) => c.walletId === selectedWalletId)
    : campaigns;

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-black/5">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px] tracking-tight text-[#1d1d1f]">alzaAds</span>
            <span className="text-[13px] text-[#86868b] font-normal">Brain</span>
          </div>
          <div className="flex items-center gap-4">
            {token && (
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="text-[13px] text-[#86868b] hover:text-[#1d1d1f]"
              >
                Nastavení
              </button>
            )}
            {token && (
              <button
                onClick={() => {
                  storage.clearToken();
                  setToken(null);
                  setStep("login");
                  setTeams([]);
                }}
                className="text-[13px] text-[#86868b] hover:text-[#1d1d1f]"
              >
                Odhlásit
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-white border-b border-black/5 px-6 py-5">
          <div className="max-w-7xl mx-auto">
            <h3 className="text-[15px] font-semibold text-[#1d1d1f] mb-3">Nastavení</h3>
            <div className="max-w-sm">
              <label className="block text-[13px] text-[#86868b] mb-1.5">
                Claude API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  storage.setSettings({ anthropicApiKey: e.target.value });
                }}
                placeholder="sk-ant-..."
                className="w-full h-9 bg-[#f5f5f7] border-0 rounded-lg px-3 text-[13px] focus:ring-2 focus:ring-[#0071e3] outline-none"
              />
              <p className="text-[12px] text-[#86868b] mt-1.5">
                Pro AI analýzu v reportech.
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-6 py-8">
        {error && (
          <div className="card px-5 py-3 mb-6 flex items-center justify-between border-l-4 border-l-red">
            <p className="text-[13px] text-red">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-[#86868b] hover:text-[#1d1d1f] text-lg leading-none"
            >
              &times;
            </button>
          </div>
        )}

        {/* LOGIN */}
        {step === "login" && (
          <div className="max-w-[360px] mx-auto mt-24">
            <div className="text-center mb-8">
              <h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">alzaAds Brain</h1>
              <p className="text-[15px] text-[#86868b] mt-2">
                Přihlaste se svým účtem
              </p>
            </div>
            <div className="card p-8">
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full h-11 bg-[#f5f5f7] border-0 rounded-xl px-4 text-[15px] text-[#1d1d1f] placeholder:text-[#86868b] focus:ring-2 focus:ring-[#0071e3] outline-none"
                    placeholder="vas@email.cz"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">
                    Heslo
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full h-11 bg-[#f5f5f7] border-0 rounded-xl px-4 text-[15px] text-[#1d1d1f] placeholder:text-[#86868b] focus:ring-2 focus:ring-[#0071e3] outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full h-11 bg-[#0071e3] text-white text-[15px] font-medium rounded-xl hover:bg-[#0077ed] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
                >
                  {loginLoading ? "Přihlašování..." : "Přihlásit se"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* CONFIGURE */}
        {step === "configure" && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-navy">Generovat report</h1>

            {/* Team Picker */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="font-medium text-navy mb-3">1. Vyberte klienta</h2>
              <input
                type="text"
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                placeholder="Hledat klienta..."
                className="w-full border border-gray-300 rounded px-3 py-2 mb-3"
              />
              {teamsLoading ? (
                <div className="text-gray-500 text-sm py-4 text-center">
                  Načítání klientů...
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto border border-gray-200 rounded">
                  {favoriteTeams.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 bg-light-blue text-xs font-medium text-navy uppercase tracking-wide">
                        Oblíbení
                      </div>
                      {favoriteTeams.map((t) => (
                        <TeamRow
                          key={t.id}
                          team={t}
                          selected={selectedTeam?.id === t.id}
                          isFavorite={true}
                          onSelect={() => setSelectedTeam(t)}
                          onToggleFavorite={() => toggleFavorite(t.id)}
                        />
                      ))}
                    </>
                  )}
                  {otherTeams.length > 0 && (
                    <>
                      {favoriteTeams.length > 0 && (
                        <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                          Ostatní ({otherTeams.length})
                        </div>
                      )}
                      {otherTeams.map((t) => (
                        <TeamRow
                          key={t.id}
                          team={t}
                          selected={selectedTeam?.id === t.id}
                          isFavorite={false}
                          onSelect={() => setSelectedTeam(t)}
                          onToggleFavorite={() => toggleFavorite(t.id)}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Date Range */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="font-medium text-navy mb-3">2. Období</h2>
              <div className="flex gap-4 items-center flex-wrap">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Od</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Do</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-2"
                  />
                </div>
                <div className="flex gap-2 ml-4">
                  {[
                    { label: "7D", days: 7 },
                    { label: "30D", days: 30 },
                    { label: "90D", days: 90 },
                  ].map(({ label, days }) => (
                    <button
                      key={label}
                      onClick={() => {
                        const to = new Date();
                        const from = new Date();
                        from.setDate(from.getDate() - days);
                        setDateFrom(from.toISOString().split("T")[0]);
                        setDateTo(to.toISOString().split("T")[0]);
                      }}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-light-blue hover:border-royal text-gray-600"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Wallet & Campaign Filters */}
            {selectedTeam && (
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h2 className="font-medium text-navy mb-3">
                  3. Filtry{" "}
                  <span className="text-gray-400 font-normal text-sm">
                    (volitelné)
                  </span>
                </h2>
                {filtersLoading ? (
                  <div className="text-gray-500 text-sm py-2">
                    Načítání filtrů...
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Wallet filter */}
                    {wallets.length > 0 && (
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">
                          Peněženka
                        </label>
                        <select
                          value={selectedWalletId}
                          onChange={(e) => {
                            setSelectedWalletId(e.target.value);
                            setSelectedCampaignIds([]);
                          }}
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        >
                          <option value="">Všechny peněženky</option>
                          {wallets
                            .filter((w) => !w.archived)
                            .map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name}
                                {w.availableBalance != null
                                  ? ` (${w.availableBalance.toLocaleString("cs-CZ")} ${w.currencyCode || "CZK"})`
                                  : ""}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {/* Campaign filter */}
                    {filteredCampaigns.length > 0 && (
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">
                          Kampaně{" "}
                          {selectedCampaignIds.length > 0 && (
                            <span className="text-royal">
                              ({selectedCampaignIds.length} vybráno)
                            </span>
                          )}
                        </label>
                        <div className="max-h-40 overflow-y-auto border border-gray-200 rounded">
                          {filteredCampaigns.map((c) => (
                            <label
                              key={c.id}
                              className="flex items-center gap-2 px-3 py-1.5 hover:bg-light-blue cursor-pointer border-b border-gray-100 last:border-0"
                            >
                              <input
                                type="checkbox"
                                checked={selectedCampaignIds.includes(c.id)}
                                onChange={() => toggleCampaign(c.id)}
                                className="rounded"
                              />
                              <span className="text-sm text-gray-800 truncate">
                                {c.name}
                              </span>
                              <span
                                className={`text-xs ml-auto px-1.5 py-0.5 rounded ${
                                  c.activeState === "ACTIVE"
                                    ? "bg-green/10 text-green"
                                    : "bg-gray-100 text-gray-500"
                                }`}
                              >
                                {c.activeState === "ACTIVE"
                                  ? "Aktivní"
                                  : c.activeState === "PAUSED"
                                    ? "Pozastavena"
                                    : c.activeState}
                              </span>
                            </label>
                          ))}
                        </div>
                        {selectedCampaignIds.length > 0 && (
                          <button
                            onClick={() => setSelectedCampaignIds([])}
                            className="text-xs text-royal hover:underline mt-1"
                          >
                            Zrušit výběr
                          </button>
                        )}
                      </div>
                    )}
                    {filteredCampaigns.length === 0 &&
                      wallets.length === 0 &&
                      !filtersLoading && (
                        <p className="text-gray-400 text-sm">
                          Pro tohoto klienta nebyly nalezeny žádné filtry.
                        </p>
                      )}
                  </div>
                )}
              </div>
            )}

            {/* Measures */}
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="font-medium text-navy mb-3">
                {selectedTeam ? "4" : "3"}. Metriky
              </h2>
              <div className="space-y-2">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                  Hlavní
                </p>
                <div className="flex flex-wrap gap-2">
                  {CORE_MEASURES.map((key) => (
                    <MeasureChip
                      key={key}
                      label={key}
                      active={selectedMeasures.includes(key)}
                      onClick={() => toggleMeasure(key)}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-2 mt-4">
                  Rozšířené
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXTENDED_MEASURES.map((key) => (
                    <MeasureChip
                      key={key}
                      label={key}
                      active={selectedMeasures.includes(key)}
                      onClick={() => toggleMeasure(key)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={handleGenerateReport}
              disabled={!selectedTeam || selectedMeasures.length === 0}
              className="w-full bg-green text-white font-bold py-3 rounded-lg text-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Generovat report
              {selectedTeam ? ` pro ${selectedTeam.name}` : ""}
            </button>
          </div>
        )}

        {/* GENERATING */}
        {step === "generating" && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-12 h-12 border-4 border-green border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-navy font-medium">{progress}</p>
          </div>
        )}

        {/* DONE */}
        {step === "done" && reportData && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-navy">
              Report připraven!
            </h1>
            <p className="text-gray-600">
              {selectedTeam?.name} | {dateFrom} – {dateTo}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={downloadPptx}
                className="bg-navy text-white rounded-lg p-6 text-center hover:opacity-90"
              >
                <div className="text-3xl mb-2">PPTX</div>
                <div className="font-bold">PowerPoint</div>
                <div className="text-sm text-white/70">
                  {analysis ? "S AI analýzou" : "Bez analýzy"}
                </div>
              </button>
              <button
                onClick={downloadExcel}
                className="bg-green text-white rounded-lg p-6 text-center hover:opacity-90"
              >
                <div className="text-3xl mb-2">XLSX</div>
                <div className="font-bold">Excel</div>
                <div className="text-sm text-white/70">
                  Formátovaný pro CZ Excel
                </div>
              </button>
              <button
                onClick={downloadCsv}
                className="bg-royal text-white rounded-lg p-6 text-center hover:opacity-90"
              >
                <div className="text-3xl mb-2">CSV</div>
                <div className="font-bold">CSV</div>
                <div className="text-sm text-white/70">
                  Středníkem oddělený
                </div>
              </button>
            </div>

            {analysis && (
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <h2 className="font-medium text-navy mb-3">AI Analýza</h2>
                <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
                  {analysis}
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setStep("configure");
                setReportData(null);
                setAnalysis(null);
              }}
              className="text-royal hover:underline text-sm"
            >
              ← Zpět na výběr klienta
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function TeamRow({
  team,
  selected,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: {
  team: TeamWithName;
  selected: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-light-blue border-b border-gray-100 last:border-0 ${selected ? "bg-light-blue ring-1 ring-royal" : ""}`}
      onClick={onSelect}
    >
      <span className="text-sm text-gray-800">{team.name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="text-lg hover:scale-110 transition-transform"
        title={
          isFavorite
            ? "Odebrat z oblíbených"
            : "Přidat do oblíbených"
        }
      >
        {isFavorite ? "★" : "☆"}
      </button>
    </div>
  );
}

function MeasureChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
        active
          ? "bg-navy text-white border-navy"
          : "bg-white text-gray-600 border-gray-300 hover:border-navy"
      }`}
    >
      {label}
    </button>
  );
}
