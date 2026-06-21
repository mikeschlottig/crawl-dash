// src/dashboard/exporters.ts — pure string exporters over CrawlRecord[].
// No DOM, no chrome — fully unit-tested. The dashboard wraps the output in a Blob.
import type { CrawlRecord, ExportFormat } from "../types";
import { ROW_COLUMNS, recordToRow } from "./rows";

export interface ExportResult {
  filename: string;
  mime: string;
  content: string;
}

// ---- CSV (RFC-4180 quoting) ----
function csvCell(v: string): string {
  if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function toCSV(records: CrawlRecord[]): string {
  const header = ROW_COLUMNS.join(",");
  const lines = records.map((r) => {
    const row = recordToRow(r);
    return ROW_COLUMNS.map((c) => csvCell(row[c])).join(",");
  });
  return [header, ...lines].join("\r\n");
}

// ---- JSON / JSONL (full fidelity, not flattened) ----
export function toJSON(records: CrawlRecord[]): string {
  return JSON.stringify(records, null, 2);
}

export function toJSONL(records: CrawlRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

// ---- Markdown (business-directory friendly) ----
function mdEscape(v: string): string {
  return v.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function toMarkdown(records: CrawlRecord[]): string {
  const out: string[] = [];
  out.push(`# Crawl Export`, "", `${records.length} record(s) · generated ${new Date().toISOString()}`, "");
  const cols = ["Name", "Hostname", "Status", "Phone", "Locality", "Confidence"];
  out.push("| " + cols.join(" | ") + " |");
  out.push("| " + cols.map(() => "---").join(" | ") + " |");
  for (const r of records) {
    const e = r.entity;
    out.push(
      "| " +
        [
          mdEscape(e?.name || r.hostname),
          mdEscape(r.hostname),
          r.status === "ok" ? String(r.capture.httpStatus ?? 200) : r.status,
          mdEscape(e?.telephones[0] ?? ""),
          mdEscape(e?.address?.locality ?? ""),
          e ? `${Math.round(e.confidence * 100)}%` : "—",
        ].join(" | ") +
        " |",
    );
  }
  return out.join("\n");
}

// ---- HTML (standalone summary) ----
function htmlEscape(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export function toHTML(records: CrawlRecord[]): string {
  const rows = records
    .map((r) => {
      const e = r.entity;
      const badge = r.status === "ok" ? `<span class="ok">${r.capture.httpStatus ?? 200}</span>` : `<span class="err">${htmlEscape(r.status)}</span>`;
      return `<tr>
        <td><strong>${htmlEscape(e?.name || r.hostname)}</strong><br><span class="u">${htmlEscape(r.url)}</span></td>
        <td>${badge}</td>
        <td>${htmlEscape(e?.telephones.join(", ") ?? "")}</td>
        <td>${htmlEscape(e?.emails.join(", ") ?? "")}</td>
        <td>${htmlEscape([e?.address?.streetAddress, e?.address?.locality, e?.address?.region, e?.address?.postalCode].filter(Boolean).join(", "))}</td>
        <td>${e ? Math.round(e.confidence * 100) + "%" : "—"} <span class="src">${e?.source ?? "none"}</span></td>
      </tr>`;
    })
    .join("\n");
  const okCount = records.filter((r) => r.status === "ok").length;
  const bizCount = records.filter((r) => r.entity && r.entity.source !== "none").length;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Crawl Export</title>
<style>
  body{font-family:system-ui,sans-serif;margin:32px;color:#0f172a;background:#f8fafc}
  h1{font-size:22px;margin:0 0 4px} .meta{color:#64748b;font-size:13px;margin-bottom:20px}
  table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:top}
  th{background:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#475569}
  .u{color:#94a3b8;font-size:11px;word-break:break-all} .src{color:#94a3b8;font-size:11px}
  .ok{color:#059669;font-weight:700} .err{color:#dc2626;font-weight:700}
</style></head><body>
<h1>Directory Crawl Export</h1>
<div class="meta">${records.length} record(s) · ${okCount} ok · ${bizCount} with business data · generated ${htmlEscape(new Date().toISOString())}</div>
<table><thead><tr><th>Business</th><th>Status</th><th>Phone</th><th>Email</th><th>Address</th><th>Confidence</th></tr></thead>
<tbody>
${rows}
</tbody></table></body></html>`;
}

// ---- dispatch ----
export function buildExport(format: ExportFormat, records: CrawlRecord[]): ExportResult {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  switch (format) {
    case "json":
      return { filename: `crawl-${stamp}.json`, mime: "application/json", content: toJSON(records) };
    case "jsonl":
      return { filename: `crawl-${stamp}.jsonl`, mime: "application/x-ndjson", content: toJSONL(records) };
    case "csv":
      return { filename: `crawl-${stamp}.csv`, mime: "text/csv", content: toCSV(records) };
    case "md":
      return { filename: `crawl-${stamp}.md`, mime: "text/markdown", content: toMarkdown(records) };
    case "html":
      return { filename: `crawl-${stamp}.html`, mime: "text/html", content: toHTML(records) };
  }
}
