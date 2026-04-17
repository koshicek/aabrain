"use client";

import { useState, useEffect, useCallback } from "react";
import { storage } from "@/lib/storage";
import { AppShell } from "@/components/sidebar";
import type { OverviewReport, DailyOverview, DailyTopVendor } from "@/lib/overview/types";

type ViewState = "loading" | "idle" | "fetching" | "ready" | "error";

export default function DailyOverviewPage() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [error, setError] = useState<string | null>(null);
  const year = 2026;
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
    <AppShell currentPath="/overview/daily">
      <div className="max-w-[1400px] mx-auto px-6 py-8">
        {error && <ErrorBanner error={error} onClose={() => setError(null)} />}

        <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f] mb-8">Denní přehled</h1>

        {state === "fetching" && (
          <div className="flex flex-col items-center py-24">
            <div className="spinner mb-5" />
            <p className="text-[15px] font-medium text-[#1d1d1f]">Načítání dat</p>
          </div>
        )}

        {report && state !== "fetching" && (
          <div className="space-y-8">
            {/* Yesterday vs day before metrics */}
            <YesterdayMetrics data={report.dailyView} />

            {/* 7-day chart */}
            {report.dailyView.length >= 7 && (
              <div className="card p-7">
                <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Denní obrat a aktivní vendoři (posledních 7 dní)</h2>
                <DailyChart data={report.dailyView.slice(-7)} />
              </div>
            )}

            {/* Top 20 vendors table */}
            {report.dailyTopVendors && report.dailyTopVendors.length > 0 && (
              <div className="card p-7">
                <h2 className="text-[17px] font-semibold text-[#1d1d1f] mb-5">Top 20 vendorů (včera vs předchozí den)</h2>
                <DailyVendorsTable vendors={report.dailyTopVendors} />
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
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

// ── Yesterday vs day before metrics ──

function YesterdayMetrics({ data }: { data: DailyOverview[] }) {
  if (data.length < 2) return null;

  const yesterday = data[data.length - 1];
  const dayBefore = data[data.length - 2];

  function delta(current: number, prev: number) {
    if (prev === 0) return undefined;
    return Math.round(((current - prev) / prev) * 1000) / 10;
  }

  return (
    <div className="card p-7">
      <div className="mb-5">
        <h2 className="text-[17px] font-semibold text-[#1d1d1f]">Včera ({yesterday.date})</h2>
        <p className="text-[13px] text-[#86868b] mt-0.5">vs předchozí den ({dayBefore.date})</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <MetricCard label="Obrat" value={fmt(yesterday.revenueCzk)} unit="CZK" delta={delta(yesterday.revenueCzk, dayBefore.revenueCzk)} />
        <MetricCard label="Aktivní vendoři" value={yesterday.activeVendors.toString()} delta={delta(yesterday.activeVendors, dayBefore.activeVendors)} />
        <MetricCard label="Aktivní kampaně" value={yesterday.activeCampaigns.toString()} delta={delta(yesterday.activeCampaigns, dayBefore.activeCampaigns)} />
        <MetricCard label="ROAS" value={yesterday.roas.toFixed(2)} unit="x" delta={delta(yesterday.roas, dayBefore.roas)} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit, delta }: { label: string; value: string; unit?: string; delta?: number }) {
  const col = delta === undefined || delta === 0 ? "text-[#86868b]" : delta > 0 ? "text-green" : "text-red";
  return (
    <div className="bg-muted/60 rounded-2xl p-5">
      <p className="text-[13px] text-[#86868b] mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-[24px] font-semibold tracking-tight text-[#1d1d1f]">{value}</span>
        {unit && <span className="text-[12px] text-[#86868b]">{unit}</span>}
      </div>
      {delta !== undefined && <p className={`text-[12px] mt-1 ${col}`}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}% vs předchozí den</p>}
    </div>
  );
}

// ── Daily chart (7 days, bars + line) ──

function DailyChart({ data }: { data: DailyOverview[] }) {
  const W = 900;
  const H = 280;
  const PAD = { top: 20, right: 60, bottom: 40, left: 70 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top - PAD.bottom;

  const maxRev = Math.max(...data.map((d) => d.revenueCzk), 1) * 1.1;
  const maxVendors = Math.max(...data.map((d) => d.activeVendors), 1) * 1.2;
  const barW = Math.min(cW / data.length * 0.65, 40);

  function xc(i: number) { return PAD.left + (i + 0.5) * (cW / data.length); }
  function yRev(v: number) { return PAD.top + cH - (v / maxRev) * cH; }
  function yV(v: number) { return PAD.top + cH - (v / maxVendors) * cH; }

  const vendorPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xc(i).toFixed(1)},${yV(d.activeVendors).toFixed(1)}`).join(" ");

  const revStep = niceStep(maxRev, 4);
  const revTicks: number[] = [];
  for (let v = 0; v <= maxRev; v += revStep) revTicks.push(v);

  const vStep = niceStep(maxVendors, 4);
  const vTicks: number[] = [];
  for (let v = 0; v <= maxVendors; v += vStep) vTicks.push(v);

  const [hover, setHover] = useState<number | null>(null);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(xc(i) - svgX);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover(best);
  }

  const hd = hover !== null ? data[hover] : null;

  function formatDay(dateStr: string): string {
    const d = new Date(dateStr);
    return `${d.getDate()}.${d.getMonth() + 1}`;
  }

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
        {data.map((d, i) => (
          <rect key={i} x={xc(i) - barW / 2} y={yRev(d.revenueCzk)} width={barW} height={cH - (yRev(d.revenueCzk) - PAD.top)}
            rx="3" fill="#0071e3" opacity={hover === i ? 1 : 0.7} />
        ))}

        {/* Vendors line */}
        <path d={vendorPath} fill="none" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={i} cx={xc(i)} cy={yV(d.activeVendors)} r={hover === i ? 4.5 : 2.5} fill="white" stroke="#34C759" strokeWidth="2" />
        ))}

        {/* Vendors right axis */}
        {vTicks.map((v) => (
          <text key={v} x={W - PAD.right + 10} y={yV(v) + 4} fontSize="11" fill="#34C759">{Math.round(v)}</text>
        ))}

        {/* Hover line */}
        {hover !== null && (
          <line x1={xc(hover)} y1={PAD.top} x2={xc(hover)} y2={PAD.top + cH} stroke="#1d1d1f" strokeWidth="0.5" opacity="0.15" />
        )}

        {/* X labels */}
        {data.map((d, i) => (
          <text key={i} x={xc(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="#86868b">{formatDay(d.date)}</text>
        ))}
      </svg>

      {/* Tooltip */}
      {hover !== null && hd && (
        <div className="absolute pointer-events-none z-10 bg-white/95 backdrop-blur-lg shadow-lg rounded-xl border border-black/5 px-4 py-3"
          style={{ left: `${(xc(hover) / W) * 100}%`, top: 4, transform: "translateX(-50%)" }}>
          <p className="text-[12px] font-semibold text-[#1d1d1f] mb-1">{formatDay(hd.date)}</p>
          <div className="space-y-0.5 text-[12px]">
            <div className="flex justify-between gap-4"><span className="text-[#86868b]">Obrat</span><span className="font-medium">{fmt(hd.revenueCzk)} CZK</span></div>
            <div className="flex justify-between gap-4"><span className="text-[#86868b]">Vendoři (unikátní)</span><span className="font-medium text-green">{hd.activeVendors}</span></div>
            <div className="flex justify-between gap-4"><span className="text-[#86868b]">ROAS</span><span className="font-medium">{hd.roas.toFixed(1)}x</span></div>
            <div className="flex justify-between gap-4"><span className="text-[#86868b]">Kampaně</span><span className="font-medium">{hd.activeCampaigns}</span></div>
          </div>
        </div>
      )}

      <div className="flex gap-5 mt-3 justify-center text-[12px] text-[#86868b]">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[#0071e3] rounded-sm opacity-70" /> Obrat (CZK)</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-[2px] bg-green rounded-full" /> Aktivní vendoři (unikátní)</div>
      </div>
    </div>
  );
}

// ── Daily vendors table ──

function DailyVendorsTable({ vendors }: { vendors: DailyTopVendor[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[12px] text-[#86868b] border-b border-[#e5e5ea]">
          <th className="pb-3 text-left font-medium w-8">#</th>
          <th className="pb-3 pr-4 text-left font-medium">Vendor</th>
          <th className="pb-3 pr-4 text-right font-medium">Obrat včera</th>
          <th className="pb-3 pr-4 text-right font-medium">Obrat předchozí den</th>
          <th className="pb-3 pr-4 text-right font-medium">Změna</th>
          <th className="pb-3 text-right font-medium">ROAS včera</th>
        </tr>
      </thead>
      <tbody>
        {vendors.map((v, i) => {
          const changeCol = v.change === 0 ? "text-[#86868b]" : v.change > 0 ? "text-green" : "text-red";
          return (
            <tr key={v.vendorId} className="border-b border-[#f5f5f7] last:border-0 hover:bg-muted/50">
              <td className="py-3 text-[#86868b]">{i + 1}</td>
              <td className="py-3 pr-4 font-medium text-[#1d1d1f]">{v.vendorName}</td>
              <td className="py-3 pr-4 text-right">{fmt(v.yesterdayObrat)} Kč</td>
              <td className="py-3 pr-4 text-right text-[#86868b]">{fmt(v.dayBeforeObrat)} Kč</td>
              <td className={`py-3 pr-4 text-right font-medium ${changeCol}`}>
                {v.dayBeforeObrat > 0 ? `${v.change > 0 ? "+" : ""}${v.change.toFixed(1)}%` : "\u2014"}
              </td>
              <td className="py-3 text-right text-[#86868b]">{"\u2014"}</td>
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
