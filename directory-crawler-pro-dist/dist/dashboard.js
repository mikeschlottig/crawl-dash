// src/types/job.ts
var DEFAULT_CONFIG = {
  timeoutMs: 3e4,
  concurrency: 3,
  perHostDelayMs: 600,
  maxRetries: 3,
  allowedDomains: [],
  keywordAlerts: [],
  engine: "render",
  fullPageScreenshot: true
};

// src/dashboard/filters.ts
var DEFAULT_FILTER = {
  query: "",
  status: "all",
  alertsOnly: false,
  businessOnly: false,
  minConfidence: 0.4
};
function matchesFilter(r, f) {
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
function applyFilter(records2, f) {
  return records2.filter((r) => matchesFilter(r, f));
}

// src/dashboard/rows.ts
var ROW_COLUMNS = [
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
  "createdAt"
];
function hoursText(r) {
  const e = r.entity;
  if (!e) return "";
  if (e.openingHours.length) {
    return e.openingHours.map((h) => `${h.days.join("/")} ${h.opens}-${h.closes}`).join("; ");
  }
  return e.openingHoursText.join("; ");
}
function recordToRow(r) {
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
    createdAt: r.createdAt
  };
}

// src/dashboard/exporters.ts
function csvCell(v) {
  if (/[",\r\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function toCSV(records2) {
  const header = ROW_COLUMNS.join(",");
  const lines = records2.map((r) => {
    const row = recordToRow(r);
    return ROW_COLUMNS.map((c) => csvCell(row[c])).join(",");
  });
  return [header, ...lines].join("\r\n");
}
function toJSON(records2) {
  return JSON.stringify(records2, null, 2);
}
function toJSONL(records2) {
  return records2.map((r) => JSON.stringify(r)).join("\n");
}
function mdEscape(v) {
  return v.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function toMarkdown(records2) {
  const out = [];
  out.push(`# Crawl Export`, "", `${records2.length} record(s) \xB7 generated ${(/* @__PURE__ */ new Date()).toISOString()}`, "");
  const cols = ["Name", "Hostname", "Status", "Phone", "Locality", "Confidence"];
  out.push("| " + cols.join(" | ") + " |");
  out.push("| " + cols.map(() => "---").join(" | ") + " |");
  for (const r of records2) {
    const e = r.entity;
    out.push(
      "| " + [
        mdEscape(e?.name || r.hostname),
        mdEscape(r.hostname),
        r.status === "ok" ? String(r.capture.httpStatus ?? 200) : r.status,
        mdEscape(e?.telephones[0] ?? ""),
        mdEscape(e?.address?.locality ?? ""),
        e ? `${Math.round(e.confidence * 100)}%` : "\u2014"
      ].join(" | ") + " |"
    );
  }
  return out.join("\n");
}
function htmlEscape(v) {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function toHTML(records2) {
  const rows = records2.map((r) => {
    const e = r.entity;
    const badge = r.status === "ok" ? `<span class="ok">${r.capture.httpStatus ?? 200}</span>` : `<span class="err">${htmlEscape(r.status)}</span>`;
    return `<tr>
        <td><strong>${htmlEscape(e?.name || r.hostname)}</strong><br><span class="u">${htmlEscape(r.url)}</span></td>
        <td>${badge}</td>
        <td>${htmlEscape(e?.telephones.join(", ") ?? "")}</td>
        <td>${htmlEscape(e?.emails.join(", ") ?? "")}</td>
        <td>${htmlEscape([e?.address?.streetAddress, e?.address?.locality, e?.address?.region, e?.address?.postalCode].filter(Boolean).join(", "))}</td>
        <td>${e ? Math.round(e.confidence * 100) + "%" : "\u2014"} <span class="src">${e?.source ?? "none"}</span></td>
      </tr>`;
  }).join("\n");
  const okCount = records2.filter((r) => r.status === "ok").length;
  const bizCount = records2.filter((r) => r.entity && r.entity.source !== "none").length;
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
<div class="meta">${records2.length} record(s) \xB7 ${okCount} ok \xB7 ${bizCount} with business data \xB7 generated ${htmlEscape((/* @__PURE__ */ new Date()).toISOString())}</div>
<table><thead><tr><th>Business</th><th>Status</th><th>Phone</th><th>Email</th><th>Address</th><th>Confidence</th></tr></thead>
<tbody>
${rows}
</tbody></table></body></html>`;
}
function buildExport(format, records2) {
  const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/[:T]/g, "-");
  switch (format) {
    case "json":
      return { filename: `crawl-${stamp}.json`, mime: "application/json", content: toJSON(records2) };
    case "jsonl":
      return { filename: `crawl-${stamp}.jsonl`, mime: "application/x-ndjson", content: toJSONL(records2) };
    case "csv":
      return { filename: `crawl-${stamp}.csv`, mime: "text/csv", content: toCSV(records2) };
    case "md":
      return { filename: `crawl-${stamp}.md`, mime: "text/markdown", content: toMarkdown(records2) };
    case "html":
      return { filename: `crawl-${stamp}.html`, mime: "text/html", content: toHTML(records2) };
  }
}

// src/dashboard/download.ts
function triggerDownload(result) {
  const blob = new Blob([result.content], { type: result.mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2e3);
}

// src/dashboard/dashboard.ts
var $ = (id) => document.getElementById(id);
var urls = $("urls");
var timeout = $("timeout");
var concurrency = $("concurrency");
var domains = $("domains");
var keywords = $("keywords");
var engineSel = $("engine");
var fullpageSel = $("fullpage");
var statusEl = $("status");
var bar = $("bar");
var logEl = $("log");
var recordsEl = $("records");
var recCount = $("reccount");
var previewEl = $("preview");
var records = /* @__PURE__ */ new Map();
var activeId = null;
var selected = /* @__PURE__ */ new Set();
var filter = { ...DEFAULT_FILTER };
var searchEl = $("search");
var statusFilterEl = $("statusFilter");
var alertsOnlyEl = $("alertsOnly");
var businessOnlyEl = $("businessOnly");
var selectAllEl = $("selectAll");
var selSummaryEl = $("selsummary");
function visibleRecords() {
  const all = Array.from(records.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return applyFilter(all, filter);
}
function syncFilterFromUI() {
  filter.query = searchEl.value;
  filter.status = statusFilterEl.value;
  filter.alertsOnly = alertsOnlyEl.checked;
  filter.businessOnly = businessOnlyEl.checked;
}
[searchEl, statusFilterEl, alertsOnlyEl, businessOnlyEl].forEach(
  (el) => el.addEventListener("input", () => {
    syncFilterFromUI();
    renderRecords();
  })
);
selectAllEl.addEventListener("change", () => {
  const vis = visibleRecords();
  if (selectAllEl.checked) vis.forEach((r) => selected.add(r.id));
  else vis.forEach((r) => selected.delete(r.id));
  renderRecords();
});
document.querySelectorAll(".xbtn").forEach(
  (btn) => btn.addEventListener("click", () => {
    const fmt = btn.dataset.fmt;
    const vis = visibleRecords();
    const chosen = selected.size ? vis.filter((r) => selected.has(r.id)) : vis;
    if (chosen.length === 0) {
      appendLog({ level: "warn", text: "Nothing to export for the current filter/selection.", ts: Date.now() });
      return;
    }
    triggerDownload(buildExport(fmt, chosen));
    appendLog({ level: "success", text: `Exported ${chosen.length} record(s) as ${fmt.toUpperCase()}.`, ts: Date.now() });
  })
);
function send(msg) {
  return chrome.runtime.sendMessage(msg).catch(() => void 0);
}
function readConfig() {
  const csv = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return {
    ...DEFAULT_CONFIG,
    timeoutMs: Math.max(5, Number(timeout.value) || 30) * 1e3,
    concurrency: Math.min(8, Math.max(1, Number(concurrency.value) || 3)),
    allowedDomains: csv(domains.value),
    keywordAlerts: csv(keywords.value),
    engine: engineSel.value || "render",
    fullPageScreenshot: fullpageSel.value !== "no"
  };
}
$("start").addEventListener("click", () => {
  const list = urls.value.split("\n").map((u) => u.trim()).filter(Boolean);
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
chrome.runtime.onMessage.addListener((ev) => {
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
function renderStatus(status, p) {
  statusEl.textContent = status;
  const pct = p.total > 0 ? Math.round(p.done / p.total * 100) : 0;
  bar.style.width = pct + "%";
  bar.textContent = `${pct}% (${p.done}/${p.total})`;
}
function appendLog(e) {
  const div = document.createElement("div");
  div.className = e.level;
  div.textContent = `[${new Date(e.ts).toLocaleTimeString()}] ${e.text}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}
function renderRecords() {
  const total = records.size;
  const vis = visibleRecords();
  recCount.textContent = total ? `(${vis.length}/${total})` : "";
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
function statusLabel(r) {
  if (r.status === "http_error") return "HTTP " + (r.capture.httpStatus ?? "?");
  return r.status;
}
async function renderPreview() {
  if (!activeId) {
    previewEl.innerHTML = '<div class="empty">Select a record to inspect its capture &amp; metadata.</div>';
    return;
  }
  const r = records.get(activeId);
  if (!r) return;
  const p = r.payload;
  const ent = r.entity;
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const list = (xs) => xs.length ? esc(xs.join(", ")) : '<span style="color:var(--faint)">none</span>';
  const addr = ent?.address ? esc([ent.address.streetAddress, ent.address.locality, ent.address.region, ent.address.postalCode].filter(Boolean).join(", ")) : '<span style="color:var(--faint)">none</span>';
  const hours = ent ? ent.openingHours.length ? esc(ent.openingHours.map((h) => `${h.days.join("/")} ${h.opens}-${h.closes}`).join(" \xB7 ")) : ent.openingHoursText.length ? esc(ent.openingHoursText.join(" \xB7 ")) : '<span style="color:var(--faint)">none</span>' : "\u2014";
  const geo = ent?.geo ? `${ent.geo.lat}, ${ent.geo.lng}` : '<span style="color:var(--faint)">none</span>';
  const rating = ent?.rating ? `${ent.rating.value} (${ent.rating.count} reviews)` : '<span style="color:var(--faint)">none</span>';
  const conf = ent ? Math.round(ent.confidence * 100) : 0;
  const confColor = conf >= 70 ? "var(--green)" : conf >= 40 ? "var(--amber)" : "var(--faint)";
  previewEl.innerHTML = `
    <div style="font-size:13px;line-height:1.7">
      <div style="font-weight:700;color:#fff;margin-bottom:6px">${esc(r.hostname)}</div>
      <div style="color:var(--faint);font-size:11px;word-break:break-all;margin-bottom:10px">${esc(r.url)}</div>
      <div><b>Status:</b> ${esc(statusLabel(r))} \xB7 <b>HTTP:</b> ${r.capture.httpStatus ?? "\u2014"} \xB7 <b>${r.capture.loadMs}ms</b> \xB7 <b>type:</b> ${esc(r.capture.contentType ?? "\u2014")}</div>

      <div style="margin:12px 0 4px;font-weight:700;color:var(--cyan);display:flex;align-items:center;gap:8px">
        Business Entity
        <span style="font-family:var(--mono);font-size:10px;padding:2px 7px;border-radius:6px;background:var(--panel2);color:${confColor}">
          ${ent?.source ?? "none"} \xB7 ${conf}%
        </span>
      </div>
      <div><b>Name:</b> ${ent && ent.name ? esc(ent.name) : '<span style="color:var(--faint)">none</span>'}</div>
      <div><b>Categories:</b> ${ent ? list(ent.categories) : "\u2014"}</div>
      <div><b>Address:</b> ${addr}</div>
      <div><b>Geo:</b> ${geo}</div>
      <div><b>Phones:</b> ${ent ? list(ent.telephones) : "\u2014"}</div>
      <div><b>Emails:</b> ${ent ? list(ent.emails) : "\u2014"}</div>
      <div><b>Hours:</b> ${hours}</div>
      <div><b>Price:</b> ${ent && ent.priceRange ? esc(ent.priceRange) : '<span style="color:var(--faint)">none</span>'} \xB7 <b>Rating:</b> ${rating}</div>
      <div><b>Social:</b> ${ent ? list(ent.sameAs) : "\u2014"}</div>

      <div style="margin:12px 0 4px;font-weight:700;color:var(--cyan)">Page Signals</div>
      <div><b>Title:</b> ${p ? esc(p.title) || '<span style="color:var(--faint)">none</span>' : "\u2014"}</div>
      <div><b>H1:</b> ${p ? list(p.headings.h1) : "\u2014"}</div>
      <div><b>Words:</b> ${p?.wordCount ?? "\u2014"} \xB7 <b>Links:</b> ${p ? `${p.links.internal} int / ${p.links.external} ext` : "\u2014"} \xB7 <b>JSON-LD:</b> ${p?.jsonLdSchemas.length ?? 0} \xB7 <b>Microdata:</b> ${p?.microdata.length ?? 0}</div>
      <div id="shot" style="margin-top:12px"></div>
    </div>`;
  const shotEl = document.getElementById("shot");
  if (r.capture.screenshotRef) {
    shotEl.innerHTML = '<div style="color:var(--faint);font-size:11px">loading capture\u2026</div>';
    const resp = await chrome.runtime.sendMessage({ kind: "GET_SCREENSHOT", ref: r.capture.screenshotRef }).catch(() => null);
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
async function reconnect() {
  const snap = await chrome.runtime.sendMessage({ kind: "GET_SNAPSHOT" }).catch(() => null);
  if (!snap) return;
  timeout.value = String(Math.round(snap.config.timeoutMs / 1e3));
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
//# sourceMappingURL=dashboard.js.map
