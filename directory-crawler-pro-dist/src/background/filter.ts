// src/background/filter.ts — exact / true-suffix domain matching (no substring spoofing).
export function passesDomainFilter(url: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false; // malformed URL is never allowed
  }
  return allowed.some((d) => {
    const dom = d.trim().toLowerCase().replace(/^\*\./, "").replace(/^\.+/, "");
    if (!dom) return false;
    return host === dom || host.endsWith("." + dom);
  });
}
