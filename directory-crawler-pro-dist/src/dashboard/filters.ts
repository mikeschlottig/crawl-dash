// src/dashboard/filters.ts — pure record filtering for the visualizer. Chrome-free, tested.
import type { CrawlRecord } from "../types";

export type StatusFilter = "all" | "ok" | "errors";

export interface FilterCriteria {
  query: string; // matches hostname, url, or entity name (case-insensitive)
  status: StatusFilter;
  alertsOnly: boolean; // has keyword hits
  businessOnly: boolean; // entity present above minConfidence
  minConfidence: number; // 0..1, applied when businessOnly
}

export const DEFAULT_FILTER: FilterCriteria = {
  query: "",
  status: "all",
  alertsOnly: false,
  businessOnly: false,
  minConfidence: 0.4,
};

export function matchesFilter(r: CrawlRecord, f: FilterCriteria): boolean {
  if (f.status === "ok" && r.status !== "ok") return false;
  if (f.status === "errors" && r.status === "ok") return false;
  if (f.alertsOnly && r.keywordHits.length === 0) return false;
  if (f.businessOnly) {
    const hasBiz = !!r.entity && r.entity.source !== "none" && r.entity.confidence >= f.minConfidence;
    if (!hasBiz) return false;
  }
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = [r.hostname, r.url, r.entity?.name ?? ""].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function applyFilter(records: CrawlRecord[], f: FilterCriteria): CrawlRecord[] {
  return records.filter((r) => matchesFilter(r, f));
}
