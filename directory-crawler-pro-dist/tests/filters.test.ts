import { describe, it, expect } from "vitest";
import { applyFilter, matchesFilter, DEFAULT_FILTER } from "../src/dashboard/filters";
import { emptyEntity } from "../src/types";
import type { CrawlRecord } from "../src/types";
import type { FilterCriteria as FC } from "../src/dashboard/filters";

function rec(over: Partial<CrawlRecord> = {}): CrawlRecord {
  return {
    id: Math.random().toString(36),
    url: "https://x.example.com/",
    hostname: "x.example.com",
    status: "ok",
    attempts: 1,
    payload: null,
    entity: null,
    capture: { httpStatus: 200, loadMs: 1, screenshotRef: null, contentType: "text/html" },
    keywordHits: [],
    createdAt: "2026-05-31T00:00:00.000Z",
    ...over,
  };
}

const base: FC = { ...DEFAULT_FILTER };

describe("matchesFilter", () => {
  it("status filter", () => {
    expect(matchesFilter(rec({ status: "ok" }), { ...base, status: "ok" })).toBe(true);
    expect(matchesFilter(rec({ status: "ok" }), { ...base, status: "errors" })).toBe(false);
    expect(matchesFilter(rec({ status: "http_error" }), { ...base, status: "errors" })).toBe(true);
  });

  it("alertsOnly requires keyword hits", () => {
    expect(matchesFilter(rec({ keywordHits: [] }), { ...base, alertsOnly: true })).toBe(false);
    expect(matchesFilter(rec({ keywordHits: ["hvac"] }), { ...base, alertsOnly: true })).toBe(true);
  });

  it("businessOnly requires entity above minConfidence", () => {
    const lowE = emptyEntity();
    lowE.source = "heuristic";
    lowE.confidence = 0.2;
    const highE = emptyEntity();
    highE.source = "json-ld";
    highE.confidence = 0.8;
    expect(matchesFilter(rec({ entity: lowE }), { ...base, businessOnly: true, minConfidence: 0.4 })).toBe(false);
    expect(matchesFilter(rec({ entity: highE }), { ...base, businessOnly: true, minConfidence: 0.4 })).toBe(true);
    expect(matchesFilter(rec({ entity: null }), { ...base, businessOnly: true })).toBe(false);
  });

  it("query matches hostname, url, or entity name (case-insensitive)", () => {
    const e = emptyEntity();
    e.name = "Rogue Valley Plumbing";
    e.source = "json-ld";
    e.confidence = 0.9;
    expect(matchesFilter(rec({ entity: e }), { ...base, query: "rogue valley" })).toBe(true);
    expect(matchesFilter(rec(), { ...base, query: "x.example" })).toBe(true);
    expect(matchesFilter(rec(), { ...base, query: "nomatch" })).toBe(false);
  });

  it("combines criteria (AND)", () => {
    const e = emptyEntity();
    e.name = "HVAC Pros";
    e.source = "json-ld";
    e.confidence = 0.9;
    const r = rec({ entity: e, keywordHits: ["hvac"], status: "ok" });
    const f: FC = { query: "hvac", status: "ok", alertsOnly: true, businessOnly: true, minConfidence: 0.5 };
    expect(matchesFilter(r, f)).toBe(true);
    expect(matchesFilter(rec({ ...r, keywordHits: [] }), f)).toBe(false);
  });
});

describe("applyFilter", () => {
  it("returns only matching records", () => {
    const recs = [rec({ status: "ok" }), rec({ status: "http_error" }), rec({ status: "timeout" })];
    expect(applyFilter(recs, { ...base, status: "errors" })).toHaveLength(2);
  });
});
