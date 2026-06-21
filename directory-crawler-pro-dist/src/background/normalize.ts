// src/background/normalize.ts — pure normalization helpers for contacts and URLs.

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
// Junk that masquerades as an email in scraped markup.
const EMAIL_JUNK = [
  "sentry",
  "wixpress",
  "example.com",
  "example.org",
  "domain.com",
  "yourdomain",
  "your@",
  "name@",
  "email@",
  "@2x",
  "u003e",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
];

export function cleanEmails(raw: string[]): string[] {
  const out = new Set<string>();
  for (const e of raw) {
    const v = e.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) continue;
    if (EMAIL_JUNK.some((j) => v.includes(j))) continue;
    out.add(v);
  }
  return Array.from(out).slice(0, 25);
}

/** Normalize a phone to a comparable form, keeping a leading + and digits only. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/[^\d]/g, "");
  return digits.length >= 7 ? plus + digits : "";
}

export function dedupePhones(raw: string[]): string[] {
  // Key on a canonical digit form so "+15415552210", "15415552210" and "5415552210"
  // all collapse. For 11-digit NANP numbers (leading "1") we drop the country digit
  // for the key. Prefer the +-prefixed display form when present.
  const canonKey = (digits: string): string =>
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  const byKey = new Map<string, string>();
  const order: string[] = [];
  for (const p of raw) {
    const norm = normalizePhone(p);
    if (!norm) continue;
    const digits = norm.replace(/^\+/, "");
    const key = canonKey(digits);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, norm);
      order.push(key);
    } else if (norm.startsWith("+") && !existing.startsWith("+")) {
      byKey.set(key, norm);
    }
  }
  return order.map((k) => byKey.get(k)!).slice(0, 25);
}

/** Canonicalize a social/profile URL for dedupe (drop query, hash, trailing slash). */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.search = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function dedupeUrls(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    if (!r) continue;
    const n = normalizeUrl(r);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(r.trim());
  }
  return out.slice(0, 25);
}

/** Strip a schema.org URL prefix from a dayOfWeek value → "Monday". */
export function dayName(raw: string): string {
  return raw.replace(/^https?:\/\/schema\.org\//i, "").trim();
}

export function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function isHtmlType(contentType: string | null | undefined): boolean {
  if (!contentType) return true; // assume HTML when unknown
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}
