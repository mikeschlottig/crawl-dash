// src/background/keywords.ts — flag records whose text surface contains industry terms.
import type { BusinessEntity, ScrapePayload } from "../types";

export function scanKeywords(payload: ScrapePayload | null, terms: string[]): string[] {
  if (!payload || terms.length === 0) return [];
  const hay = [
    payload.title,
    payload.description,
    ...payload.headings.h1,
    ...payload.headings.h2,
    ...payload.headings.h3,
  ]
    .join(" \n ")
    .toLowerCase();
  return terms.map((t) => t.trim()).filter((t) => t.length > 0 && hay.includes(t.toLowerCase()));
}

/** Union of keyword hits across the scraped payload and the normalized entity. */
export function collectKeywordHits(
  payload: ScrapePayload | null,
  entity: BusinessEntity | null,
  terms: string[],
): string[] {
  if (terms.length === 0) return [];
  const hits = new Set(scanKeywords(payload, terms));
  if (entity) {
    const hay = [entity.name, entity.description, ...entity.categories, ...entity.types]
      .join(" \n ")
      .toLowerCase();
    for (const t of terms) {
      const term = t.trim();
      if (term && hay.includes(term.toLowerCase())) hits.add(term);
    }
  }
  return Array.from(hits);
}
