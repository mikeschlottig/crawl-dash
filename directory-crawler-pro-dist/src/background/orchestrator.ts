// src/background/orchestrator.ts
// Concurrency pool over the durable JobState. Never trusts RAM for queue state —
// every transition is a serialized storage transaction, so a killed-and-respawned
// service worker reconstructs and resumes from chrome.storage.
import type { CrawlRecord, JobConfig, QueueItem } from "../types";
import { readState, updateState, putRecord } from "./store";
import { reconcileOrphans, pullSlots, applyFinalize, isDrained } from "./reducers";
import { withRetry, recordFromError } from "./retry";
import { runEngine, closeCrawlerWindow } from "./engine";
import { errorRecord } from "./records";
import { ensureKeepAlive, releaseKeepAlive } from "./keepalive";
import { passesDomainFilter } from "./filter";
import { hashUrl } from "./hash";
import { emit, emitStatus, log } from "./bus";

/** Set synchronously at the top of pump() so concurrent triggers no-op. */
let pumping = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function startCrawl(urls: string[], config: JobConfig): Promise<void> {
  const items: QueueItem[] = urls
    .map((u) => u.trim())
    .filter(Boolean)
    .filter((u) => passesDomainFilter(u, config.allowedDomains))
    .map((u) => ({ id: hashUrl(u), url: u, attempts: 0 }));

  const skipped = urls.filter((u) => u.trim()).length - items.length;

  await updateState((s) => {
    s.config = config;
    s.queue.push(...items);
    s.progress.total += items.length;
    s.status = "running";
  });

  await log("info", `Queued ${items.length} target(s)${skipped ? `, skipped ${skipped} (domain filter)` : ""}.`);
  await ensureKeepAlive();
  await emitStatus();
  void pump();
}

export async function pause(): Promise<void> {
  await updateState((s) => {
    s.status = "paused";
  });
  await log("warn", "Crawl paused. In-flight targets finish; queue is held.");
  await emitStatus();
}

export async function resume(): Promise<void> {
  await updateState((s) => {
    if (s.status === "paused") s.status = "running";
  });
  await ensureKeepAlive();
  await log("info", "Crawl resumed.");
  await emitStatus();
  void pump();
}

/**
 * Called on every service-worker wake (cold start, keepalive ping, alarm).
 * If a crawl was running when the worker died, requeue orphaned in-flight items
 * and restart the pool. This is the forced-kill survival path.
 */
export async function resumeIfNeeded(): Promise<void> {
  const s = await readState();
  if (s.status !== "running" || pumping) return;

  const { resumed, dropped } = await updateState((st) => reconcileOrphans(st));
  if (resumed > 0 || dropped > 0) {
    await log(
      "success",
      `Worker restarted — recovered ${resumed} orphaned target(s)` +
        (dropped ? `, dropped ${dropped} over retry budget.` : "."),
    );
    await emitStatus();
  }
  // The crawler window (and any half-captured tabs) died with the worker — discard the
  // stale handle so the capture engine spawns a clean one on the next item.
  await closeCrawlerWindow();
  await ensureKeepAlive();
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const started = await updateState((s) => pullSlots(s));
      for (const item of started) void runItem(item);

      const state = await readState();
      if (state.status !== "running") break;

      if (isDrained(state)) {
        await updateState((s) => {
          s.status = "idle";
        });
        await releaseKeepAlive();
        await closeCrawlerWindow();
        await log("success", `Crawl complete — ${state.progress.done} processed, ${state.progress.failed} failed.`);
        await emitStatus();
        break;
      }
      await sleep(Math.max(120, state.config.perHostDelayMs));
    }
  } finally {
    pumping = false;
  }
}

async function runItem(item: QueueItem): Promise<void> {
  const config = (await readState()).config;
  let record: CrawlRecord;
  try {
    record = await withRetry(() => runEngine(item, config), config.maxRetries);
  } catch (err) {
    // Engines attach a finished record to PermanentError/TransientError (e.g. a 404 page).
    record = recordFromError(err) ?? errorRecord(item, err);
  }
  await finalize(item, record);
}

async function finalize(item: QueueItem, record: CrawlRecord): Promise<void> {
  await putRecord(record);
  await updateState((s) => applyFinalize(s, item.id, record.status));

  emit({ kind: "RECORD_DONE", record });
  if (record.keywordHits.length) {
    emit({ kind: "KEYWORD_HIT", recordId: record.id, hostname: record.hostname, terms: record.keywordHits });
  }
  const tag =
    record.status === "ok"
      ? "ok"
      : record.capture.httpStatus
        ? `HTTP ${record.capture.httpStatus}`
        : record.status;
  await log(record.status === "ok" ? "info" : "error", `${tag} · ${record.url}`);
  await emitStatus();
}
