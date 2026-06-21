// src/dashboard/dashboard.ts — typed control center. Reconnects via GET_SNAPSHOT so it
// is accurate even when opened mid-crawl or after a forced worker restart.
import type {
  CrawlEngine,
  CrawlRecord,
  DashboardMessage,
  JobConfig,
  JobProgress,
  JobStatus,
  LogEntry,
  Snapshot,
  WorkerEvent,
} from "../types";
import { DEFAULT_CONFIG } from "../types";
import { type FilterCriteria, DEFAULT_FILTER, applyFilter } from "./filters";
import { buildExport } from "./exporters";
import { triggerDownload } from "./download";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const urls = $<HTMLTextAreaElement>("urls");
const timeout = $<HTMLInputElement>("timeout");
const concurrency = $<HTMLInputElement>("concurrency");
const domains = $<HTMLInputElement>("domains");
const keywords = $<HTMLInputElement>("keywords");
const engineSel = $<HTMLSelectElement>("engine");
const fullpageSel = $<HTMLSelectElement>("fullpage");
const statusEl = $("status");
const bar = $("bar");
const logEl = $("log");
const recordsEl = $("records");
const recCount = $("reccount");
const previewEl = $("preview");

const records = new Map<string, CrawlRecord>();
let activeId: string | null = null;
const selected = new Set<string>();
const filter: FilterCriteria = { ...DEFAULT_FILTER };

const searchEl = $<HTMLInputElement>("search");
const statusFilterEl = $<HTMLSelectElement>("statusFilter");
const alertsOnlyEl = $<HTMLInputElement>("alertsOnly");
const businessOnlyEl = $<HTMLInputElement>("businessOnly");
const selectAllEl = $<HTMLInputElement>("selectAll");
const selSummaryEl = $("selsummary");

function visibleRecords(): CrawlRecord[] {
  const all = Array.from(records.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return applyFilter(all, filter);
}

function syncFilterFromUI(): void {
  filter.query = searchEl.value;
  filter.status = statusFilterEl.value as FilterCriteria["status"];
  filter.alertsOnly = alertsOnlyEl.checked;
  filter.businessOnly = businessOnlyEl.checked;
}

[searchEl, statusFilterEl, alertsOnlyEl, businessOnlyEl].forEach((el) =>
  el.addEventListener("input", () => {
    syncFilterFromUI();
    renderRecords();
  }),
);

selectAllEl.addEventListener("change", () => {
  const vis = visibleRecords();
  if (selectAllEl.checked) vis.forEach((r) => selected.add(r.id));
  else vis.forEach((r) => selected.delete(r.id));
  renderRecords();
});

// Export buttons: act on selection if any, else the full filtered set.
document.querySelectorAll<HTMLButtonElement>(".xbtn").forEach((btn) =>
  btn.addEventListener("click", () => {
    const fmt = btn.dataset.fmt as "json" | "jsonl" | "csv" | "md" | "html";
    const vis = visibleRecords();
    const chosen = selected.size ? vis.filter((r) => selected.has(r.id)) : vis;
    if (chosen.length === 0) {
      appendLog({ level: "warn", text: "Nothing to export for the current filter/selection.", ts: Date.now() });
      return;
    }
    triggerDownload(buildExport(fmt, chosen));
    appendLog({ level: "success", text: `Exported ${chosen.length} record(s) as ${fmt.toUpperCase()}.`, ts: Date.now() });
  }),
);

function send(msg: DashboardMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(msg).catch(() => undefined);
}

function readConfig(): JobConfig {
  const csv = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  return {
    ...DEFAULT_CONFIG,
    timeoutMs: Math.max(5, Number(timeout.value) || 30) * 1000,
    concurrency: Math.min(8, Math.max(1, Number(concurrency.value) || 3)),
    allowedDomains: csv(domains.value),
    keywordAlerts: csv(keywords.value),
    engine: (engineSel.value as CrawlEngine) || "render",
    fullPageScreenshot: fullpageSel.value !== "no",
  };
}

$("start").addEventListener("click", () => {
  const list = urls.value
    .split("\n")
    .map((u) => u.trim())
    .filter(Boolean);
  if (list.length === 0) {
    appendLog({ level: "warn", text: "Add at least one URL.", ts: Date.now() });
    return;
  }
  void send({ kind: "START_CRAWL", urls: list, config: readConfig() });
});
$("pause").addEventListener("click", () => void send({ kind: "PAUSE_CRAWL" }));
$("resume").addEventListener("click", () => void send({ kind: "RESUME_CRAWL" }));
$("clear").addEventListener("click", () => {
  if (!confirm("Erase all stored records?")) return;
  records.clear();
  selected.clear();
  activeId = null;
  renderRecords();
  void renderPreview();
  void send({ kind: "CLEAR_HISTORY" });
});

// ---- live events ----
chrome.runtime.onMessage.addListener((ev: WorkerEvent) => {
  switch (ev.kind) {
    case "STATUS":
      renderStatus(ev.status, ev.progress);
      break;
    case "LOG":
      appendLog(ev.entry);
      break;
    case "RECORD_DONE":
      records.set(ev.record.id, ev.record);
      renderRecords();
      break;
    case "KEYWORD_HIT":
      appendLog({ level: "success", text: `\u2605 keyword [${ev.terms.join(", ")}] on ${ev.hostname}`, ts: Date.now() });
      break;
  }
});

function renderStatus(status: JobStatus, p: JobProgress): void {
  statusEl.textContent = status;
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  bar.style.width = pct + "%";
  bar.textContent = `${pct}% (${p.done}/${p.total})`;
}

function appendLog(e: LogEntry): void {
  const div = document.createElement("div");
  div.className = e.level;
  div.textContent = `[${new Date(e.ts).toLocaleTimeString()}] ${e.text}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

function renderRecords(): void {
  const total = records.size;
  const vis = visibleRecords();
  recCount.textContent = total ? `(${vis.length}/${total})` : "";

  // selection summary + select-all state
  const visSelected = vis.filter((r) => selected.has(r.id)).length;
  selSummaryEl.textContent = visSelected ? `${visSelected} selected` : "Select all";
  selectAllEl.checked = vis.length > 0 && visSelected === vis.length;
  selectAllEl.indeterminate = visSelected > 0 && visSelected < vis.length;

  if (total === 0) {
    recordsEl.innerHTML = '<div class="empty">No records yet.</div>';
    return;
  }
  if (vis.length === 0) {
    recordsEl.innerHTML = '<div class="empty">No records match the current filter.</div>';
    return;
  }
  recordsEl.innerHTML = "";
  for (const r of vis) {
    const row = document.createElement("div");
    row.className = "rec" + (r.id === activeId ? " active" : "");

    const sel = document.createElement("input");
    sel.type = "checkbox";
    sel.className = "selbox";
    sel.checked = selected.has(r.id);
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", () => {
      if (sel.checked) selected.add(r.id);
      else selected.delete(r.id);
      renderRecords();
    });

    const host = document.createElement("span");
    host.className = "host";
    host.textContent = r.entity?.name || r.hostname;
    host.title = r.url;

    const status = document.createElement("span");
    status.className = "pill " + (r.status === "ok" ? "ok" : "err");
    status.textContent = r.status === "ok" ? `${r.capture.httpStatus ?? 200}` : statusLabel(r);

    row.append(sel, host, status);
    if (r.entity && r.entity.source !== "none" && r.entity.confidence >= 0.4) {
      const ent = document.createElement("span");
      ent.className = "pill biz";
      ent.textContent = "biz " + Math.round(r.entity.confidence * 100) + "%";
      ent.title = r.entity.name || "business entity detected";
      row.append(ent);
    }
    if (r.keywordHits.length) {
      const kw = document.createElement("span");
      kw.className = "pill kw";
      kw.textContent = "\u2605 " + r.keywordHits.length;
      row.append(kw);
    }
    row.addEventListener("click", () => {
      activeId = r.id;
      renderRecords();
      void renderPreview();
    });
    recordsEl.appendChild(row);
  }
}

function statusLabel(r: CrawlRecord): string {
  if (r.status === "http_error") return "HTTP " + (r.capture.httpStatus ?? "?");
  return r.status;
}

async function renderPreview(): Promise<void> {
  if (!activeId) {
    previewEl.innerHTML = '<div class="empty">Select a record to inspect its capture &amp; metadata.</div>';
    return;
  }
  const r = records.get(activeId);
  if (!r) return;
  const p = r.payload;
  const ent = r.entity;
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
  const list = (xs: string[]) => (xs.length ? esc(xs.join(", ")) : '<span style="color:var(--faint)">none</span>');

  const addr = ent?.address
    ? esc([ent.address.streetAddress, ent.address.locality, ent.address.region, ent.address.postalCode].filter(Boolean).join(", "))
    : '<span style="color:var(--faint)">none</span>';
  const hours = ent
    ? ent.openingHours.length
      ? esc(ent.openingHours.map((h) => `${h.days.join("/")} ${h.opens}-${h.closes}`).join(" · "))
      : ent.openingHoursText.length
        ? esc(ent.openingHoursText.join(" · "))
        : '<span style="color:var(--faint)">none</span>'
    : "—";
  const geo = ent?.geo ? `${ent.geo.lat}, ${ent.geo.lng}` : '<span style="color:var(--faint)">none</span>';
  const rating = ent?.rating ? `${ent.rating.value} (${ent.rating.count} reviews)` : '<span style="color:var(--faint)">none</span>';
  const conf = ent ? Math.round(ent.confidence * 100) : 0;
  const confColor = conf >= 70 ? "var(--green)" : conf >= 40 ? "var(--amber)" : "var(--faint)";

  previewEl.innerHTML = `
    <div style="font-size:13px;line-height:1.7">
      <div style="font-weight:700;color:#fff;margin-bottom:6px">${esc(r.hostname)}</div>
      <div style="color:var(--faint);font-size:11px;word-break:break-all;margin-bottom:10px">${esc(r.url)}</div>
      <div><b>Status:</b> ${esc(statusLabel(r))} · <b>HTTP:</b> ${r.capture.httpStatus ?? "—"} · <b>${r.capture.loadMs}ms</b> · <b>type:</b> ${esc(r.capture.contentType ?? "—")}</div>

      <div style="margin:12px 0 4px;font-weight:700;color:var(--cyan);display:flex;align-items:center;gap:8px">
        Business Entity
        <span style="font-family:var(--mono);font-size:10px;padding:2px 7px;border-radius:6px;background:var(--panel2);color:${confColor}">
          ${ent?.source ?? "none"} · ${conf}%
        </span>
      </div>
      <div><b>Name:</b> ${ent && ent.name ? esc(ent.name) : '<span style="color:var(--faint)">none</span>'}</div>
      <div><b>Categories:</b> ${ent ? list(ent.categories) : "—"}</div>
      <div><b>Address:</b> ${addr}</div>
      <div><b>Geo:</b> ${geo}</div>
      <div><b>Phones:</b> ${ent ? list(ent.telephones) : "—"}</div>
      <div><b>Emails:</b> ${ent ? list(ent.emails) : "—"}</div>
      <div><b>Hours:</b> ${hours}</div>
      <div><b>Price:</b> ${ent && ent.priceRange ? esc(ent.priceRange) : '<span style="color:var(--faint)">none</span>'} · <b>Rating:</b> ${rating}</div>
      <div><b>Social:</b> ${ent ? list(ent.sameAs) : "—"}</div>

      <div style="margin:12px 0 4px;font-weight:700;color:var(--cyan)">Page Signals</div>
      <div><b>Title:</b> ${p ? esc(p.title) || '<span style="color:var(--faint)">none</span>' : "—"}</div>
      <div><b>H1:</b> ${p ? list(p.headings.h1) : "—"}</div>
      <div><b>Words:</b> ${p?.wordCount ?? "—"} · <b>Links:</b> ${p ? `${p.links.internal} int / ${p.links.external} ext` : "—"} · <b>JSON-LD:</b> ${p?.jsonLdSchemas.length ?? 0} · <b>Microdata:</b> ${p?.microdata.length ?? 0}</div>
      <div id="shot" style="margin-top:12px"></div>
    </div>`;

  const shotEl = document.getElementById("shot")!;
  if (r.capture.screenshotRef) {
    shotEl.innerHTML = '<div style="color:var(--faint);font-size:11px">loading capture…</div>';
    const resp = (await chrome.runtime
      .sendMessage({ kind: "GET_SCREENSHOT", ref: r.capture.screenshotRef })
      .catch(() => null)) as { dataUrl: string | null } | null;
    if (resp?.dataUrl) {
      const img = document.createElement("img");
      img.src = resp.dataUrl;
      img.style.cssText = "width:100%;border:1px solid var(--line2);border-radius:8px;margin-top:4px";
      shotEl.innerHTML = "";
      shotEl.appendChild(img);
    } else {
      shotEl.innerHTML = '<div style="color:var(--faint);font-size:11px">capture unavailable</div>';
    }
  } else {
    shotEl.innerHTML = '<div style="color:var(--faint);font-size:11px">no screenshot (fetch engine or viewport-only)</div>';
  }
}

// ---- reconnect on open ----
async function reconnect(): Promise<void> {
  const snap = (await chrome.runtime.sendMessage({ kind: "GET_SNAPSHOT" }).catch(() => null)) as Snapshot | null;
  if (!snap) return;
  timeout.value = String(Math.round(snap.config.timeoutMs / 1000));
  concurrency.value = String(snap.config.concurrency);
  domains.value = snap.config.allowedDomains.join(", ");
  keywords.value = snap.config.keywordAlerts.join(", ");
  engineSel.value = snap.config.engine;
  fullpageSel.value = snap.config.fullPageScreenshot ? "yes" : "no";
  for (const r of snap.records) records.set(r.id, r);
  logEl.innerHTML = "";
  for (const e of snap.logs) appendLog(e);
  renderStatus(snap.status, snap.progress);
  renderRecords();
}

void reconnect();
