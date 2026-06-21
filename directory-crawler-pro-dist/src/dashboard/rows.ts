// src/dashboard/rows.ts — flatten a CrawlRecord into a stable, ordered row.
// Pure + chrome-free so exporters are fully unit-testable. The column order here is the
// contract for CSV/JSONL headers; keep it stable.
import type { CrawlRecord } from "../types";

export const ROW_COLUMNS = [
  "url",
  "hostname",
  "status",
  "httpStatus",
  "loadMs",
  "contentType",
  "entitySource",
  "entityConfidence",
  "name",
  "categories",
  "streetAddress",
  "locality",
  "region",
  "postalCode",
  "country",
  "lat",
  "lng",
  "phones",
  "emails",
  "openingHours",
  "priceRange",
  "ratingValue",
  "ratingCount",
  "sameAs",
  "keywordHits",
  "createdAt",
] as const;

export type RowColumn = (typeof ROW_COLUMNS)[number];
export type FlatRow = Record<RowColumn, string>;

function hoursText(r: CrawlRecord): string {
  const e = r.entity;
  if (!e) return "";
  if (e.openingHours.length) {
    return e.openingHours.map((h) => `${h.days.join("/")} ${h.opens}-${h.closes}`).join("; ");
  }
  return e.openingHoursText.join("; ");
}

export function recordToRow(r: CrawlRecord): FlatRow {
  const e = r.entity;
  const a = e?.address ?? null;
  return {
    url: r.url,
    hostname: r.hostname,
    status: r.status,
    httpStatus: r.capture.httpStatus != null ? String(r.capture.httpStatus) : "",
    loadMs: String(r.capture.loadMs),
    contentType: r.capture.contentType ?? "",
    entitySource: e?.source ?? "none",
    entityConfidence: e ? String(e.confidence) : "0",
    name: e?.name ?? "",
    categories: (e?.categories ?? []).join("; "),
    streetAddress: a?.streetAddress ?? "",
    locality: a?.locality ?? "",
    region: a?.region ?? "",
    postalCode: a?.postalCode ?? "",
    country: a?.country ?? "",
    lat: e?.geo ? String(e.geo.lat) : "",
    lng: e?.geo ? String(e.geo.lng) : "",
    phones: (e?.telephones ?? []).join("; "),
    emails: (e?.emails ?? []).join("; "),
    openingHours: hoursText(r),
    priceRange: e?.priceRange ?? "",
    ratingValue: e?.rating ? String(e.rating.value) : "",
    ratingCount: e?.rating ? String(e.rating.count) : "",
    sameAs: (e?.sameAs ?? []).join("; "),
    keywordHits: r.keywordHits.join("; "),
    createdAt: r.createdAt,
  };
}
