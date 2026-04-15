"use client";

import { useState, useEffect, useCallback } from "react";
import { storage } from "@/lib/storage";
import type { OverviewReport, CountryWeekly, TotalWeekly, QuarterMetrics, DailyOverview, TopVendor } from "@/lib/overview/types";

type ViewState = "loading" | "idle" | "fetching" | "ready" | "error";

export default function Overview() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [report, setReport] = useState<OverviewReport | null>(null);

  // Login
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  function handleLogout() {
    storage.clearToken(); setToken(null); setState("idle"); setReport(null);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault(); setLoginLoading(true); setError(null);
    try {
      const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      storage.setToken(data.accessToken); setToken(data.accessToken); setState("idle");
    } catch { setError("Přihlášení se nezdařilo."); }
    finally { setLoginLoading(false); }
  }

  useEffect(() => {
    const saved = storage.getToken();
    if (saved) { setToken(saved); setState("idle"); } else { setState("idle"); }
  }, []);

  const fetchReport = useCallback(async () => {
    if (!token) return;
    setState("fetching"); setError(null);
    try {
      const res = await fetch(`/api/overview?year=${year}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReport(data as OverviewReport);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení selhalo");
      setState("error");
    }
  }, [token, year]);

  useEffect(() => { if (token) fetchReport(); }, [token, fetchReport]);

  // ── Login ──
  if (!token) return (
    <div className="min-h-screen bg-muted">
      <Header />
      <main className="max-w-[360px] mx-auto px-6 mt-24">
        <div className="text-center mb-8">
          <h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">alzaAds Brain</h1>
          <p className="text-[15px] text-[#86868b] mt-2">Přihlaste se svým účtem</p>
        </div>
        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}
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
              className="w-full h-11 bg-[#0071e3] text-white text-[15px] font-medium rounded-xl hover:bg-[#0077ed] disabled:opacity-40 active:scale-[0.98] transition-transform">
              {loginLoading ? "Přihlašování..." : "Přihlásit se"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );

  // ── Authenticated ──
  return (
    <div className="min-h-screen bg-muted">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-black/5">
        <div className="max-w-[1400px] mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px] tracking-tight text-[#1d1d1f]">alzaAds</span>
            <span className="text-[13px] text-[#86868b]">Brain</span>
            <span className="text-[#d2d2d7] mx-2">|</span>
            <span className="text-[13px] font-medium text-[#1d1d1f]">Overview</span>
          </div>
          <button onClick={handleLogout} className="text-[13px] text-[#86868b] hover:text-[#1d1d1f]">Odhlásit</button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-8">
        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}

        {/* Year selector */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f]">AlzaAds Overview {year}</h1>
          <div className="seg-group h-9 items-center">
            {[2025, 2026].map((y) => (
              <button key={y} onClick={() => setYear(y)} className={`seg-btn !py-0 h-7 ${year === y ? "active" : ""}`}>{y}</button>
            ))}
          </div>
        </div>

        {state === "fetching" && (
          <div className="flex flex-col items-center py-24">
            <div className="spinner mb-5" />
            <p className="text-[15px] font-medium text-[#1d1d1f]">Načítání overview</p>
          </div>
        )}

        {report && state !== "fetching" && (
          <div className="space-y-8">
            {/* ── Daily View ── */}
            <DailySection data={report.dailyView} />

            {/* ── Chart ── */}
            {report.totals.length > 1 && (
              <div className="card p-7">
                <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Týdenní obrat a ROAS</h2>
                <WeeklyChart totals={report.totals} />
              </div>
            )}

            {/* ── Weekly Table ── */}
            <div className="card p-7 overflow-x-auto">
              <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Týdenní report</h2>
              <WeeklyTable countries={report.countries} totals={report.totals} totalQuarters={report.totalQuarters} />
            </div>

            {/* ── Top 10 Vendors ── */}
            {report.topVendors.length > 0 && (
              <div className="card p-7">
                <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Top 10 vendorů</h2>
                <VendorsTable vendors={report.topVendors} />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-black/5">
      <div className="max-w-[1400px] mx-auto px-6 h-12 flex items-center">
        <span className="font-semibold text-[15px] tracking-tight text-[#1d1d1f]">alzaAds</span>
        <span className="text-[13px] text-[#86868b] ml-2">Brain</span>
      </div>
    </header>
  );
}

function ErrorBanner({ error, onClose }: { error: string; onClose: () => void }) {
  return (
    <div className="card px-5 py-3 mb-6 flex items-center justify-between border-l-4 border-l-red">
      <p className="text-[13px] text-red">{error}</p>
      <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] text-lg leading-none">&times;</button>
    </div>
  );
}

// ── Daily metrics ──

function DailySection({ data }: { data: DailyOverview[] }) {
  if (data.length === 0) return null;
  const yesterday = data[data.length - 1];
  const weekDays = data.slice(-7);
  const weekAvg = {
    revenueCzk: weekDays.reduce((s, d) => s + d.revenueCzk, 0) / weekDays.length,
    activeVendors: Math.round(weekDays.reduce((s, d) => s + d.activeVendors, 0) / weekDays.length),
    activeCampaigns: Math.round(weekDays.reduce((s, d) => s + d.activeCampaigns, 0) / weekDays.length),
    roas: weekDays.reduce((s, d) => s + d.roas, 0) / weekDays.length,
  };

  function delta(current: number, avg: number) {
    if (avg === 0) return 0;
    return Math.round(((current - avg) / avg) * 1000) / 10;
  }

  return (
    <div className="card p-7">
      <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-1">Denní přehled</h2>
      <p className="text-[13px] text-[#86868b] mb-5">{yesterday.date}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <DailyMetric label="Obrat" value={fmt(yesterday.revenueCzk)} unit="CZK" delta={delta(yesterday.revenueCzk, weekAvg.revenueCzk)} />
        <DailyMetric label="Aktivní vendoři" value={yesterday.activeVendors.toString()} delta={delta(yesterday.activeVendors, weekAvg.activeVendors)} />
        <DailyMetric label="Aktivní kampaně" value={yesterday.activeCampaigns.toString()} delta={delta(yesterday.activeCampaigns, weekAvg.activeCampaigns)} />
        <DailyMetric label="ROAS" value={yesterday.roas.toFixed(2)} unit="x" delta={delta(yesterday.roas, weekAvg.roas)} />
      </div>
    </div>
  );
}

function DailyMetric({ label, value, unit, delta }: { label: string; value: string; unit?: string; delta: number }) {
  const col = delta === 0 ? "text-[#86868b]" : delta > 0 ? "text-green" : "text-red";
  return (
    <div className="bg-muted/60 rounded-2xl p-5">
      <p className="text-[13px] text-[#86868b] mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-[24px] font-semibold tracking-tight text-[#1d1d1f]">{value}</span>
        {unit && <span className="text-[12px] text-[#86868b]">{unit}</span>}
      </div>
      <p className={`text-[12px] mt-1 ${col}`}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}% vs 7d avg</p>
    </div>
  );
}

// ── Weekly chart (bars + line) ──

function WeeklyChart({ totals }: { totals: TotalWeekly[] }) {
  const W = 900;
  const H = 280;
  const PAD = { top: 20, right: 60, bottom: 40, left: 70 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const maxRev = Math.max(...totals.map((t) => t.revenueCzk), 1) * 1.1;
  const maxRoas = Math.max(...totals.map((t) => t.roas), 1) * 1.2;
  const barW = Math.min(cW / totals.length * 0.65, 28);

  function xc(i: number) { return PAD.left + (i + 0.5) * (cW / totals.length); }
  function yRev(v: number) { return PAD.top + cH - (v / maxRev) * cH; }
  function yRoas(v: number) { return PAD.top + cH - (v / maxRoas) * cH; }

  // ROAS line
  const roasPath = totals.map((t, i) => `${i === 0 ? "M" : "L"}${xc(i).toFixed(1)},${yRoas(t.roas).toFixed(1)}`).join(" ");

  // Y-axis ticks
  const revStep = niceStep(maxRev, 4);
  const revTicks: number[] = [];
  for (let v = 0; v <= maxRev; v += revStep) revTicks.push(v);

  const labelStep = Math.max(1, Math.floor(totals.length / 12));

  const [hover, setHover] = useState<number | null>(null);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < totals.length; i++) {
      const d = Math.abs(xc(i) - svgX);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover(best);
  }

  const hd = hover !== null ? totals[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* Grid */}
        {revTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} y1={yRev(v)} x2={W - PAD.right} y2={yRev(v)} stroke="#e5e5ea" strokeWidth="0.5" />
            <text x={PAD.left - 10} y={yRev(v) + 4} textAnchor="end" fontSize="11" fill="#86868b">{fmtAxis(v)}</text>
          </g>
        ))}

        {/* Bars */}
        {totals.map((t, i) => (
          <rect key={i} x={xc(i) - barW / 2} y={yRev(t.revenueCzk)} width={barW} height={cH - (yRev(t.revenueCzk) - PAD.top)}
            rx="3" fill={hover === i ? "#0071e3" : "#0071e3"} opacity={hover === i ? 1 : 0.7} />
        ))}

        {/* ROAS line */}
        <path d={roasPath} fill="none" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {totals.map((t, i) => (
          <circle key={i} cx={xc(i)} cy={yRoas(t.roas)} r={hover === i ? 4.5 : 2.5} fill="white" stroke="#34C759" strokeWidth="2" />
        ))}

        {/* ROAS right axis */}
        {[0, Math.round(maxRoas / 2), Math.round(maxRoas)].map((v) => (
          <text key={v} x={W - PAD.right + 10} y={yRoas(v) + 4} fontSize="11" fill="#34C759">{v}x</text>
        ))}

        {/* Hover line */}
        {hover !== null && (
          <line x1={xc(hover)} y1={PAD.top} x2={xc(hover)} y2={PAD.top + cH} stroke="#1d1d1f" strokeWidth="0.5" opacity="0.15" />
        )}

        {/* X labels */}
        {totals.map((t, i) => {
          if (i % labelStep !== 0 && i !== totals.length - 1) return null;
          return <text key={i} x={xc(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="#86868b">{t.weekLabel}</text>;
        })}
      </svg>

      {/* Tooltip */}
      {hover !== null && hd && (
        <div className="absolute pointer-events-none z-10 bg-white/95 backdrop-blur-lg shadow-lg rounded-xl border border-black/5 px-4 py-3"
          style={{ left: `${(xc(hover) / W) * 100}%`, top: 4, transform: "translateX(-50%)" }}>
          <p className="text-[12px] font-semibold text-[#1d1d1f] mb-1">{hd.weekLabel} ({hd.weekRange})</p>
          <div className="space-y-0.5 text-[12px]">
            <div className="flex justify-between gap-4"><span className="text-[#86868b]">Obrat</span><span className="font-medium">{fmt(hd.revenueCzk)} CZK</span></div>
            <div className="flex justify-between gap-4"><span className="text-[#86868b]">ROAS</span><span className="font-medium text-green">{hd.roas.toFixed(1)}x</span></div>
            <div className="flex justify-between gap-4"><span className="text-[#86868b]">Vendoři</span><span className="font-medium">{hd.activeVendors}</span></div>
            <div className="flex justify-between gap-4"><span className="text-[#86868b]">Kampaně</span><span className="font-medium">{hd.activeCampaigns}</span></div>
          </div>
        </div>
      )}

      <div className="flex gap-5 mt-3 justify-center text-[12px] text-[#86868b]">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[#0071e3] rounded-sm opacity-70" /> Obrat (CZK)</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-[2px] bg-green rounded-full" /> ROAS</div>
      </div>
    </div>
  );
}

// ── Weekly table (matches the screenshot structure) ──

function WeeklyTable({ countries, totals, totalQuarters }: { countries: CountryWeekly[]; totals: TotalWeekly[]; totalQuarters: QuarterMetrics[] }) {
  // Build columns: weeks interleaved with quarter summaries
  type Column = { type: "week"; data: TotalWeekly; idx: number } | { type: "quarter"; data: QuarterMetrics };
  const columns: Column[] = [];
  let lastQ = 0;
  for (let i = 0; i < totals.length; i++) {
    const q = Math.floor(new Date(totals[i].weekStart).getMonth() / 3) + 1;
    if (q !== lastQ && lastQ > 0) {
      const qd = totalQuarters.find((tq) => tq.label === `Q${lastQ}`);
      if (qd) columns.push({ type: "quarter", data: qd });
    }
    lastQ = q;
    columns.push({ type: "week", data: totals[i], idx: i });
  }
  // Add final quarter
  const finalQ = totalQuarters.find((tq) => tq.label === `Q${lastQ}`);
  if (finalQ) columns.push({ type: "quarter", data: finalQ });

  // Country data lookup
  function countryWeekData(country: string, weekStart: string) {
    const c = countries.find((cc) => cc.country === country);
    return c?.weeks.find((w) => w.weekStart === weekStart);
  }
  function countryQuarterData(country: string, label: string) {
    const c = countries.find((cc) => cc.country === country);
    return c?.quarters.find((q) => q.label === label);
  }

  const countryColors: Record<string, string> = { CZ: "bg-[#0071e3]", SK: "bg-[#34C759]", HU: "bg-[#FF9500]" };
  const allCountries = ["CZ", "SK", "HU"].filter((c) => countries.some((cc) => cc.country === c));

  return (
    <div className="overflow-x-auto -mx-2">
      <table className="text-[12px] w-max min-w-full">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white z-10 w-[140px] min-w-[140px]" />
            {columns.map((col, i) => (
              <th key={i} className={`px-3 py-2 text-center font-semibold whitespace-nowrap ${col.type === "quarter" ? "bg-[#34C759]/10 text-green" : "text-[#1d1d1f]"}`}>
                {col.type === "week" ? col.data.weekLabel : col.data.label}
                {col.type === "week" && (
                  <div className="font-normal text-[10px] text-[#86868b]">{col.data.weekRange}</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Per country */}
          {allCountries.map((country) => {
            const cur = countries.find((c) => c.country === country)?.currency || "CZK";
            return (
              <CountryRows key={country} country={country} currency={cur}
                columns={columns} color={countryColors[country]}
                getWeek={(ws) => countryWeekData(country, ws)}
                getQuarter={(label) => countryQuarterData(country, label)} />
            );
          })}

          {/* Celkem */}
          <tr><td colSpan={columns.length + 1} className="h-2" /></tr>
          <tr className="bg-[#1d1d1f]/5">
            <td className="sticky left-0 bg-[#f0f0f2] z-10 px-3 py-1.5 font-bold text-[#1d1d1f] text-[13px]" colSpan={1}>Celkem</td>
            {columns.map((_, i) => <td key={i} className="bg-[#f0f0f2]" />)}
          </tr>
          <MetricRow label="Aktivní vendoři" columns={columns}
            weekVal={(col) => { const d = col.type === "week" ? col.data as TotalWeekly : col.data as QuarterMetrics; return d.activeVendors.toString(); }} isBold />
          <MetricRow label="Aktivní kampaně" columns={columns}
            weekVal={(col) => { const d = col.type === "week" ? col.data as TotalWeekly : col.data as QuarterMetrics; return d.activeCampaigns.toString(); }} isBold />
          <MetricRow label="Celkový obrat" columns={columns}
            weekVal={(col) => { const d = col.type === "week" ? col.data as TotalWeekly : col.data as QuarterMetrics; const rev = col.type === "week" ? (d as TotalWeekly).revenueCzk : (d as QuarterMetrics).revenueCzk; return `${fmt(rev)} Kč`; }} isBold highlight />
          <MetricRow label="ROAS" columns={columns}
            weekVal={(col) => { const d = col.type === "week" ? col.data as TotalWeekly : col.data as QuarterMetrics; return `${d.roas.toFixed(1)}x`; }} isBold />
        </tbody>
      </table>
    </div>
  );
}

function CountryRows({ country, currency, columns, color, getWeek, getQuarter }: {
  country: string; currency: string; color: string;
  columns: Array<{ type: "week" | "quarter"; data: unknown }>;
  getWeek: (ws: string) => { activeVendors: number; activeCampaigns: number; revenue: number; roas: number } | undefined;
  getQuarter: (label: string) => QuarterMetrics | undefined;
}) {
  return (
    <>
      <tr><td colSpan={columns.length + 1} className="h-1" /></tr>
      <tr>
        <td className="sticky left-0 bg-white z-10 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${color}`} />
            <span className="font-bold text-[13px] text-[#1d1d1f]">{country}</span>
            <span className="text-[10px] text-[#86868b]">{currency}</span>
          </div>
        </td>
        {columns.map((_, i) => <td key={i} />)}
      </tr>
      <MetricRow label="Aktivní vendoři" columns={columns} weekVal={(col) => {
        if (col.type === "week") { const d = getWeek((col.data as TotalWeekly).weekStart); return d ? d.activeVendors.toString() : "—"; }
        const d = getQuarter((col.data as QuarterMetrics).label); return d ? d.activeVendors.toString() : "—";
      }} />
      <MetricRow label="Aktivní kampaně" columns={columns} weekVal={(col) => {
        if (col.type === "week") { const d = getWeek((col.data as TotalWeekly).weekStart); return d ? d.activeCampaigns.toString() : "—"; }
        const d = getQuarter((col.data as QuarterMetrics).label); return d ? d.activeCampaigns.toString() : "—";
      }} />
      <MetricRow label="Celkový obrat" columns={columns} highlight weekVal={(col) => {
        if (col.type === "week") { const d = getWeek((col.data as TotalWeekly).weekStart); return d ? `${fmt(d.revenue)} ${currency}` : "—"; }
        const d = getQuarter((col.data as QuarterMetrics).label); return d ? `${fmt(d.revenue)} ${currency}` : "—";
      }} />
      <MetricRow label="ROAS" columns={columns} weekVal={(col) => {
        if (col.type === "week") { const d = getWeek((col.data as TotalWeekly).weekStart); return d ? `${d.roas.toFixed(1)}x` : "—"; }
        const d = getQuarter((col.data as QuarterMetrics).label); return d ? `${d.roas.toFixed(1)}x` : "—";
      }} />
    </>
  );
}

function MetricRow({ label, columns, weekVal, isBold, highlight }: {
  label: string;
  columns: Array<{ type: "week" | "quarter"; data: unknown }>;
  weekVal: (col: { type: "week" | "quarter"; data: unknown }) => string;
  isBold?: boolean;
  highlight?: boolean;
}) {
  return (
    <tr className={highlight ? "bg-[#0071e3]/3" : ""}>
      <td className={`sticky left-0 ${highlight ? "bg-[#eef5fd]" : "bg-white"} z-10 px-3 py-1.5 text-[#86868b] whitespace-nowrap ${isBold ? "font-medium text-[#1d1d1f]" : ""}`}>
        {label}
      </td>
      {columns.map((col, i) => (
        <td key={i} className={`px-3 py-1.5 text-right whitespace-nowrap ${col.type === "quarter" ? "bg-[#34C759]/5 font-semibold" : ""} ${isBold ? "font-medium" : ""}`}>
          {weekVal(col)}
        </td>
      ))}
    </tr>
  );
}

// ── Top 10 vendors ──

function VendorsTable({ vendors }: { vendors: TopVendor[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[12px] text-[#86868b] border-b border-[#e5e5ea]">
          <th className="pb-3 text-left font-medium w-8">#</th>
          <th className="pb-3 pr-4 text-left font-medium">Vendor</th>
          <th className="pb-3 pr-4 text-right font-medium">Obrat (tento týden)</th>
          <th className="pb-3 pr-4 text-right font-medium">Obrat (minulý)</th>
          <th className="pb-3 pr-4 text-right font-medium">Změna</th>
          <th className="pb-3 pr-4 text-right font-medium">ROAS</th>
          <th className="pb-3 text-right font-medium">ROAS (minulý)</th>
        </tr>
      </thead>
      <tbody>
        {vendors.map((v, i) => {
          const changeCol = v.revenueChange === 0 ? "text-[#86868b]" : v.revenueChange > 0 ? "text-green" : "text-red";
          return (
            <tr key={v.vendorId} className="border-b border-[#f5f5f7] last:border-0 hover:bg-muted/50">
              <td className="py-3 text-[#86868b]">{i + 1}</td>
              <td className="py-3 pr-4 font-medium text-[#1d1d1f]">{v.vendorName}</td>
              <td className="py-3 pr-4 text-right">{fmt(v.thisWeekRevenue)} Kč</td>
              <td className="py-3 pr-4 text-right text-[#86868b]">{fmt(v.lastWeekRevenue)} Kč</td>
              <td className={`py-3 pr-4 text-right font-medium ${changeCol}`}>
                {v.revenueChange > 0 ? "+" : ""}{v.revenueChange.toFixed(1)}%
              </td>
              <td className="py-3 pr-4 text-right">{v.thisWeekRoas.toFixed(1)}x</td>
              <td className="py-3 text-right text-[#86868b]">{v.lastWeekRoas.toFixed(1)}x</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Math.round(n).toLocaleString("cs-CZ");
}

function fmtAxis(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return Math.round(v).toString();
}

function niceStep(max: number, ticks: number): number {
  const rough = max / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  return (n <= 1.5 ? 1 : n <= 3 ? 2 : n <= 7 ? 5 : 10) * pow;
}
