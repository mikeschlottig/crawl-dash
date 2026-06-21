import { describe, it, expect } from "vitest";
import { toCSV, toJSON, toJSONL, toMarkdown, toHTML, buildExport } from "../src/dashboard/exporters";
import { recordToRow, ROW_COLUMNS } from "../src/dashboard/rows";
import { emptyEntity } from "../src/types";
import type { CrawlRecord } from "../src/types";

function rec(over: Partial<CrawlRecord> = {}): CrawlRecord {
  return {
    id: "id1",
    url: "https://acme.example.com/contact",
    hostname: "acme.example.com",
    status: "ok",
    attempts: 1,
    payload: null,
    entity: null,
    capture: { httpStatus: 200, loadMs: 412, screenshotRef: null, contentType: "text/html" },
    keywordHits: [],
    createdAt: "2026-05-31T00:00:00.000Z",
    ...over,
  };
}

function bizEntity() {
  const e = emptyEntity();
  e.source = "json-ld";
  e.confidence = 0.9;
  e.name = 'Acme, "The Best" Co';
  e.categories = ["Plumber"];
  e.telephones = ["+15415550100"];
  e.emails = ["info@acme.example.com"];
  e.address = { streetAddress: "1 Main St", locality: "Medford", region: "OR", postalCode: "97501", country: "US" };
  e.geo = { lat: 42.3, lng: -122.8 };
  e.openingHours = [{ days: ["Monday"], opens: "08:00", closes: "17:00" }];
  e.priceRange = "$$";
  e.rating = { value: 4.7, count: 50 };
  e.sameAs = ["https://facebook.com/acme"];
  return e;
}

describe("recordToRow", () => {
  it("flattens entity fields in column order", () => {
    const row = recordToRow(rec({ entity: bizEntity() }));
    expect(row.name).toBe('Acme, "The Best" Co');
    expect(row.locality).toBe("Medford");
    expect(row.phones).toBe("+15415550100");
    expect(row.openingHours).toBe("Monday 08:00-17:00");
    expect(row.entityConfidence).toBe("0.9");
    expect(ROW_COLUMNS.length).toBe(Object.keys(row).length);
  });
});

describe("toCSV", () => {
  it("quotes cells containing commas and quotes (RFC-4180)", () => {
    const csv = toCSV([rec({ entity: bizEntity() })]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(ROW_COLUMNS.join(","));
    // name has a comma and embedded quotes → must be wrapped and doubled
    expect(lines[1]).toContain('"Acme, ""The Best"" Co"');
  });

  it("emits header-only for an empty set", () => {
    expect(toCSV([])).toBe(ROW_COLUMNS.join(","));
  });
});

describe("toJSONL", () => {
  it("is one JSON object per line, newline-separated", () => {
    const out = toJSONL([rec(), rec({ id: "id2" })]);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe("id1");
    expect(JSON.parse(lines[1]).id).toBe("id2");
  });
});

describe("toJSON", () => {
  it("round-trips", () => {
    const parsed = JSON.parse(toJSON([rec()]));
    expect(parsed[0].hostname).toBe("acme.example.com");
  });
});

describe("toMarkdown", () => {
  it("escapes pipes and renders a table", () => {
    const e = bizEntity();
    e.name = "A|B Plumbing";
    const md = toMarkdown([rec({ entity: e })]);
    expect(md).toContain("| Name | Hostname |");
    expect(md).toContain("A\\|B Plumbing");
  });
});

describe("toHTML", () => {
  it("escapes html-significant characters", () => {
    const e = bizEntity();
    e.name = "<script>alert(1)</script>";
    const html = toHTML([rec({ entity: e })]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("buildExport", () => {
  it("produces correct mime + extension per format", () => {
    expect(buildExport("csv", [rec()]).mime).toBe("text/csv");
    expect(buildExport("csv", [rec()]).filename.endsWith(".csv")).toBe(true);
    expect(buildExport("jsonl", [rec()]).mime).toBe("application/x-ndjson");
    expect(buildExport("html", [rec()]).filename.endsWith(".html")).toBe(true);
  });
});
