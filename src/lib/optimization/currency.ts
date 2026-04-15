// ---------------------------------------------------------------------------
// CNB exchange rates — fetched once per day, cached server-side
// ---------------------------------------------------------------------------

import { cacheGet, cacheSet } from "./cache";

const CNB_URL = "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt";
const CACHE_KEY = "cnb-rates";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface ExchangeRates {
  EUR: number; // e.g. 24.35 (1 EUR = 24.35 CZK)
  HUF: number; // e.g. 0.06694 (1 HUF = 0.06694 CZK) — stored per 1 HUF
  CZK: number; // always 1
  date: string;
}

export async function getExchangeRates(): Promise<ExchangeRates> {
  const cached = cacheGet<ExchangeRates>(CACHE_KEY);
  if (cached) return cached;

  const rates = await fetchCnbRates();
  cacheSet(CACHE_KEY, rates, ONE_DAY_MS);
  return rates;
}

async function fetchCnbRates(): Promise<ExchangeRates> {
  const res = await fetch(CNB_URL);
  const text = await res.text();

  // Parse CNB format:
  // Header line 1: date
  // Header line 2: column names
  // Data lines: země|měna|množství|kód|kurz
  // e.g. "EMU|euro|1|EUR|24,350"
  // e.g. "Maďarsko|forint|100|HUF|6,694"

  const lines = text.split("\n");
  const dateMatch = lines[0]?.match(/(\d{2}\.\d{2}\.\d{4})/);
  const date = dateMatch ? dateMatch[1] : new Date().toISOString().split("T")[0];

  let eurRate = 25; // fallback
  let hufPer100 = 6.5; // fallback

  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const code = parts[3]?.trim();
    const amount = parseInt(parts[2]?.trim() || "1", 10);
    const rate = parseFloat(parts[4]?.trim().replace(",", ".") || "0");
    if (code === "EUR") {
      eurRate = rate / amount;
    } else if (code === "HUF") {
      hufPer100 = rate / amount; // rate is per `amount` units
    }
  }

  return {
    EUR: eurRate,
    HUF: hufPer100, // per 1 HUF
    CZK: 1,
    date,
  };
}

/** Convert an amount from a given currency to CZK */
export function toCzk(amount: number, currency: string, rates: ExchangeRates): number {
  if (currency === "CZK") return amount;
  const rate = rates[currency as keyof ExchangeRates];
  if (typeof rate === "number") return amount * rate;
  return amount; // unknown currency, return as-is
}
