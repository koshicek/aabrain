import type { TeamOptConfig } from "@/lib/optimization/types";
import { DEFAULT_OPT_CONFIG } from "@/lib/optimization/types";

const PREFIX = "aabrain_";

export interface AppSettings {
  model: string;
  language: "cs" | "en";
  defaultDateRange: "7d" | "30d" | "90d" | "custom";
  anthropicApiKey: string;
}

export interface ReportMeta {
  id: string;
  teamId: string;
  teamName: string;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  measures: string[];
}

const DEFAULT_SETTINGS: AppSettings = {
  model: "claude-sonnet-4-6",
  language: "cs",
  defaultDateRange: "30d",
  anthropicApiKey: "",
};

function get<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function set<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export const storage = {
  getFavoriteTeams(): string[] {
    return get<string[]>("favorites", []);
  },
  setFavoriteTeams(ids: string[]): void {
    set("favorites", ids);
  },
  toggleFavorite(teamId: string): string[] {
    const favs = this.getFavoriteTeams();
    const idx = favs.indexOf(teamId);
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.push(teamId);
    }
    this.setFavoriteTeams(favs);
    return favs;
  },
  getRecentReports(): ReportMeta[] {
    return get<ReportMeta[]>("recent_reports", []);
  },
  addRecentReport(meta: ReportMeta): void {
    const reports = this.getRecentReports();
    reports.unshift(meta);
    set("recent_reports", reports.slice(0, 20));
  },
  getSettings(): AppSettings {
    return get<AppSettings>("settings", DEFAULT_SETTINGS);
  },
  setSettings(s: Partial<AppSettings>): void {
    const current = this.getSettings();
    set("settings", { ...current, ...s });
  },
  getToken(): string | null {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(PREFIX + "token");
  },
  setToken(token: string): void {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(PREFIX + "token", token);
  },
  clearToken(): void {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(PREFIX + "token");
  },
  getTeamOptConfig(teamId: string): TeamOptConfig {
    return get<TeamOptConfig>(`opt_config_${teamId}`, DEFAULT_OPT_CONFIG);
  },
  setTeamOptConfig(teamId: string, config: TeamOptConfig): void {
    set(`opt_config_${teamId}`, config);
  },
  getTheme(): "light" | "dark" {
    if (typeof window === "undefined") return "light";
    try {
      const raw = localStorage.getItem(PREFIX + "theme");
      return raw === '"dark"' ? "dark" : "light";
    } catch {
      return "light";
    }
  },
  setTheme(theme: "light" | "dark"): void {
    set("theme", theme);
  },
};
