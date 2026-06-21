# Directory Crawler Pro — P0 + P1 + P2 + P3 + P4

Enterprise business-directory crawler for Chrome (Manifest V3).

- **P0 — Skeleton:** strict-TypeScript project, four bundled entrypoints, popup → detached
  control-center window, wired service-worker router.
- **P1 — Engine core:** durable persisted queue, bounded concurrency pool, retry with
  backoff + jitter, true-suffix domain filter, watchdog, and **service-worker survival
  under forced termination.**
- **P2 — Capture engine:** CDP rendered capture — real HTTP status from the
  Network domain, `Page.loadEventFired` navigation gating, injected auto-scroll + a
  rendered-DOM scraper, and **true full-page screenshots** via
  `getLayoutMetrics` + `captureBeyondViewport`, all in a single **off-screen, unfocused,
  non-minimized** window (minimized windows stop painting → blank captures). Plus an
  on-page **Inspector** that renders the capture and extracted metadata.
- **P3 — Extraction intelligence (this drop):** a structured **BusinessEntity**
  normalizer that merges **JSON-LD** (incl. `@graph` traversal, array `@type`, subtype
  detection like `Plumber`/`HVACBusiness`), **microdata**, and an OpenGraph/contact
  **heuristic** fallback into one clean record — name, address, geo, phones, emails,
  opening hours, price, rating, social profiles — with a 0–1 **confidence** score and a
  `source` tag. Contacts are normalized and deduped (NANP phone canonicalization, email
  junk-filtering, URL canonicalization). Adds **content-type handling** (non-HTML
  responses recorded without extraction) and richer page signals (canonical, lang,
  robots, word count, internal/external link stats). The Inspector renders the full
  entity; record rows get a `biz NN%` badge.
- **P4 — Surface (this drop):** a **searchable, filterable visualizer** (search by
  host/url/business name; filter by status, keyword alerts, or business-only with a
  confidence floor) with **per-row selection** + select-all, and **five exporters** —
  JSON, JSONL, CSV, Markdown, HTML — operating on the current selection (or the full
  filtered set when nothing is selected). The `BusinessEntity` flattens to a stable
  26-column row; CSV uses RFC-4180 quoting (verified to round-trip with embedded commas,
  quotes, and newlines). Downloads run from the dashboard window via `Blob` — no extra
  permission.

The engine is selectable: **render** (default — CDP + screenshot) or **fetch** (the P1
lightweight HTTP path). If the debugger can't attach to a given page, the render engine
gracefully falls back to fetch for that one target instead of failing it.

> **The debugger banner.** While the render engine runs, Chrome shows
> "Directory Crawler Pro started debugging this browser." That's unavoidable with the
> `debugger` API. Use the **fetch** engine if you need it gone, or suppress it via
> enterprise policy in a managed environment.

---

## Build

```bash
pnpm install
pnpm build        # tsc --noEmit (strict) + esbuild → dist/
pnpm test         # vitest: filter / retry / hash / reducers / records
```

Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → select the repo
root (folder with `manifest.json`). Click the toolbar icon → **Open Control Center**.

---

## P2 capture — what to look for

1. Open the Control Center, leave **Engine = Render** and **Full-page screenshot = Yes**.
2. Paste a mix and **Start**:

   ```
   https://example.com
   https://news.ycombinator.com
   https://httpbin.org/html
   https://httpbin.org/status/404
   https://httpbin.org/status/503
   ```
3. You'll see Chrome's debugging banner appear (expected). Each `ok` record gets a
   **full-page PNG**; click a record to open the **Inspector** — screenshot + title,
   emails, phones, H1s, JSON-LD count, HTTP status, and load time.
4. The `404` lands as `http_error` (no retry); the `503` is retried with backoff, then
   recorded as `http_error` if it keeps failing. Both are visually distinct from timeouts.

### Why CDP instead of `captureVisibleTab`

`captureVisibleTab` can't see a non-foreground tab and returns blank on a minimized
window. The render engine attaches the debugger, so it captures the compositor surface
(`fromSurface: true`) of an **unfocused, off-screen** tab and gets the **full page** via
`captureBeyondViewport` + a `clip` sized from `getLayoutMetrics` — no focus stealing, no
blank frames, and the main-document HTTP status comes from the same session.

---

## Forced-kill test (still holds in P2)

Same procedure as P1 — start a crawl, kill the service worker from
`chrome://extensions → service worker → Stop`, and watch it recover:

```
Worker restarted — recovered N orphaned target(s)
```

In P2 the resume path also **discards the stale crawler window** (its half-captured tabs
died with the worker) so the capture engine spawns a clean one. Recovery logic is unit-
tested without a browser:

```bash
pnpm test   # tests/reducers.test.ts
```

---

## Layout

```
manifest.json            MV3 (P2 perms: storage, unlimitedStorage, offscreen, alarms,
                         tabs, scripting, debugger + host_permissions)
src/types/               single source of truth (barrel-exported)
src/background/
  orchestrator.ts        pool driver, resume, finalize
  reducers.ts            pure state transitions (unit-tested)
  engine.ts              render|fetch dispatch + graceful fallback
  capture.ts             CDP render engine: attach, navigate, status, mime, screenshot
  fetcher.ts             fetch engine (content-type aware, richer extraction)
  entity.ts              JSON-LD/microdata/heuristic BusinessEntity normalizer (tested)
  normalize.ts           contact/url normalization + dedupe (tested)
  records.ts             shared record builders (build entity here)
  store.ts               typed storage (state/config/records/screenshots/logs)
  retry.ts filter.ts hash.ts keywords.ts keepalive.ts bus.ts
  index.ts               SW entry (sync listeners, wake-driven resume, router)
src/content/             scraper.ts (microdata/links/signals) + autoscroll.ts (injected)
src/offscreen/           keepalive ping
src/dashboard/
  dashboard.ts           control center: live events, filter/selection, export wiring
  filters.ts             pure record filtering (tested)
  rows.ts                CrawlRecord → stable 26-column flat row (tested)
  exporters.ts           JSON/JSONL/CSV/MD/HTML string builders (tested)
  download.ts            Blob + anchor download trigger (chrome-side)
src/popup/               toolbar launcher
tests/                   vitest — filter, retry, hash, reducers, records, normalize,
                         entity, exporters, filters
```

## Still ahead

- **P5 — Scale:** Cloudflare Worker bulk tier (residential proxies; shared `CrawlRecord`).
