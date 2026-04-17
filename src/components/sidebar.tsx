"use client";

import { useState, useEffect } from "react";
import { storage } from "@/lib/storage";

const NAV_ITEMS = [
  { href: "/overview", label: "Přehled" },
  { href: "/overview/daily", label: "Denní přehled" },
  { href: "/dashboard", label: "Daily Report" },
];

export function AppShell({
  children,
  currentPath,
}: {
  children: React.ReactNode;
  currentPath: string;
}) {
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setThemeState(storage.getTheme());
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setThemeState(next);
    storage.setTheme(next);
    document.documentElement.dataset.theme = next;
  }

  function handleLogout() {
    storage.clearToken();
    window.location.href = "/dashboard";
  }

  return (
    <div className="min-h-screen bg-muted flex">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex flex-col w-[220px] shrink-0 sticky top-0 h-screen border-r border-black/5 bg-white/80 backdrop-blur-xl z-40">
        {/* Logo */}
        <div className="px-5 h-14 flex items-center gap-2 border-b border-black/5">
          <span className="font-semibold text-[15px] tracking-tight text-[#1d1d1f]">alzaAds</span>
          <span className="text-[13px] text-[#86868b]">Brain</span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = currentPath === item.href;
            return (
              <a key={item.href} href={item.href}
                className={`flex items-center h-9 px-3 rounded-lg text-[14px] transition-colors ${
                  active
                    ? "bg-[#0071e3]/10 text-[#0071e3] font-medium"
                    : "text-[#1d1d1f] hover:bg-muted"
                }`}>
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Bottom controls */}
        <div className="px-3 py-4 border-t border-black/5 space-y-2">
          <button onClick={toggleTheme}
            className="flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] text-[#86868b] hover:bg-muted w-full transition-colors">
            <span className="text-[16px]">{theme === "light" ? "☾" : "☀"}</span>
            {theme === "light" ? "Tmavý režim" : "Světlý režim"}
          </button>
          <button onClick={handleLogout}
            className="flex items-center h-9 px-3 rounded-lg text-[13px] text-[#86868b] hover:bg-muted w-full transition-colors">
            Odhlásit
          </button>
        </div>
      </aside>

      {/* ── Mobile header ── */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-12 backdrop-blur-xl bg-white/80 border-b border-black/5 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setMobileOpen(!mobileOpen)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-[#1d1d1f] text-[18px]">
            {mobileOpen ? "✕" : "☰"}
          </button>
          <span className="font-semibold text-[15px] tracking-tight text-[#1d1d1f]">alzaAds</span>
          <span className="text-[13px] text-[#86868b]">Brain</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className="theme-toggle">
            {theme === "light" ? "☾" : "☀"}
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ── */}
      {mobileOpen && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="lg:hidden fixed top-12 left-0 bottom-0 z-50 w-[260px] bg-white border-r border-black/5 overflow-y-auto">
            <nav className="px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const active = currentPath === item.href;
                return (
                  <a key={item.href} href={item.href}
                    className={`flex items-center h-10 px-3 rounded-lg text-[15px] transition-colors ${
                      active
                        ? "bg-[#0071e3]/10 text-[#0071e3] font-medium"
                        : "text-[#1d1d1f] hover:bg-muted"
                    }`}>
                    {item.label}
                  </a>
                );
              })}
            </nav>
            <div className="px-3 py-4 border-t border-black/5">
              <button onClick={handleLogout}
                className="flex items-center h-10 px-3 rounded-lg text-[15px] text-[#86868b] hover:bg-muted w-full transition-colors">
                Odhlásit
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 min-w-0 lg:pt-0 pt-12">
        {children}
      </main>
    </div>
  );
}
