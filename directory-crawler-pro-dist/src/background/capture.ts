// src/background/capture.ts
// "render" engine. Drives a real tab through the Chrome DevTools Protocol:
//   • attaches the debugger BEFORE navigation so the main-document HTTP status is captured
//   • waits on Page.loadEventFired (raced against the per-page watchdog)
//   • injects auto-scroll + the rendered-DOM scraper
//   • takes a true full-page screenshot via getLayoutMetrics + captureBeyondViewport
// Tabs live in a single off-screen, UNFOCUSED, NORMAL window (never minimized — minimized
// windows stop painting and produce blank captures), so this works headless-ish without
// stealing focus. Every exit path tears down the listener, detaches, and closes the tab.
import type { CrawlRecord, JobConfig, QueueItem, ScrapePayload } from "../types";
import { PermanentError, TransientError } from "./retry";
import { makeRecord } from "./records";
import { putScreenshot } from "./store";
import { scraperPipeline } from "../content/scraper";
import { autoScroll } from "../content/autoscroll";

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const PROTOCOL_VERSION = "1.3";
const MAX_SHOT_HEIGHT = 18_000; // safety clamp on absurdly tall pages
const SETTLE_MS = 400;

// ---- crawler window lifecycle (single window, many tabs) ----
let windowId: number | null = null;
let creating: Promise<number> | null = null;

async function ensureWindow(): Promise<number> {
  if (windowId != null) {
    try {
      await chrome.windows.get(windowId);
      return windowId;
    } catch {
      windowId = null; // stale (e.g. after a forced SW kill / user close)
    }
  }
  if (!creating) {
    creating = chrome.windows
      .create({ url: "about:blank", focused: false, type: "normal", width: 1280, height: 1600, left: -2400, top: 0 })
      .then((w) => {
        windowId = w.id ?? null;
        if (windowId == null) throw new Error("window creation returned no id");
        return windowId;
      })
      .finally(() => {
        creating = null;
      });
  }
  return creating;
}

export async function closeCrawlerWindow(): Promise<void> {
  if (windowId != null) {
    const id = windowId;
    windowId = null;
    await chrome.windows.remove(id).catch(() => undefined);
  }
}

// ---- a single crawl ----
export async function renderEngine(item: QueueItem, config: JobConfig): Promise<CrawlRecord> {
  const winId = await ensureWindow();
  const tab = await chrome.tabs.create({ windowId: winId, url: "about:blank", active: false });
  const tabId = tab.id;
  if (tabId == null) throw new TransientError("tab creation returned no id");

  const debuggee: chrome.debugger.Debuggee = { tabId };
  const started = Date.now();
  let httpStatus: number | null = null;
  let contentType: string | null = null;
  let settled = false;

  let resolveLoad!: () => void;
  let rejectLoad!: (e: Error) => void;
  const loaded = new Promise<void>((res, rej) => {
    resolveLoad = res;
    rejectLoad = rej;
  });

  const onEvent: Parameters<typeof chrome.debugger.onEvent.addListener>[0] = (src, method, params) => {
    if (src.tabId !== tabId) return;
    if (method === "Network.responseReceived") {
      const p = params as { type?: string; response?: { status?: number; mimeType?: string } } | undefined;
      if (p?.type === "Document" && httpStatus === null && typeof p.response?.status === "number") {
        httpStatus = p.response.status;
        contentType = p.response.mimeType ?? null;
      }
    } else if (method === "Page.loadEventFired") {
      resolveLoad();
    } else if (method === "Inspector.detached") {
      rejectLoad(new TransientError("debugger detached"));
    }
  };

  const cleanup = async () => {
    if (settled) return;
    settled = true;
    chrome.debugger.onEvent.removeListener(onEvent);
    await chrome.debugger.detach(debuggee).catch(() => undefined);
    await chrome.tabs.remove(tabId).catch(() => undefined);
  };

  const watchdog = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new TransientError(`timeout ${config.timeoutMs}ms`)), config.timeoutMs),
  );

  const work = (async (): Promise<CrawlRecord> => {
    await chrome.debugger.attach(debuggee, PROTOCOL_VERSION);
    chrome.debugger.onEvent.addListener(onEvent);
    await send(debuggee, "Network.enable");
    await send(debuggee, "Page.enable");

    const nav = (await send(debuggee, "Page.navigate", { url: item.url })) as { errorText?: string };
    if (nav?.errorText) throw new TransientError(`nav: ${nav.errorText}`);

    await loaded; // resolves on Page.loadEventFired (or rejects on detach)

    if (httpStatus !== null && httpStatus >= 400) {
      // capture what we can, then classify
      const payload = await scrape(tabId).catch(() => null);
      const rec = makeRecord({
        item,
        status: "http_error",
        httpStatus,
        loadMs: Date.now() - started,
        payload,
        screenshotRef: null,
        contentType,
        keywordAlerts: config.keywordAlerts,
      });
      if (TRANSIENT_STATUS.has(httpStatus)) throw new TransientError("HTTP " + httpStatus, rec);
      throw new PermanentError("HTTP " + httpStatus, rec);
    }

    await inject(tabId, autoScroll);
    await delay(SETTLE_MS);
    const payload = await scrape(tabId);

    let screenshotRef: string | null = null;
    if (config.fullPageScreenshot) {
      const dataUrl = await captureFullPage(debuggee).catch(() => null);
      if (dataUrl) screenshotRef = await putScreenshot(item.id, dataUrl);
    }

    return makeRecord({
      item,
      status: "ok",
      httpStatus: httpStatus ?? 200,
      loadMs: Date.now() - started,
      payload,
      screenshotRef,
      contentType,
      keywordAlerts: config.keywordAlerts,
    });
  })();

  try {
    return await Promise.race([work, watchdog]);
  } finally {
    await cleanup();
  }
}

// ---- helpers ----
function send(d: chrome.debugger.Debuggee, method: string, params?: object): Promise<unknown> {
  return chrome.debugger.sendCommand(d, method, params);
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function inject(tabId: number, func: () => unknown | Promise<unknown>): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, func });
}

async function scrape(tabId: number): Promise<ScrapePayload> {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: scraperPipeline });
  return res.result as ScrapePayload;
}

interface LayoutMetrics {
  cssContentSize?: { width: number; height: number };
  contentSize?: { width: number; height: number };
}

async function captureFullPage(d: chrome.debugger.Debuggee): Promise<string> {
  const metrics = (await send(d, "Page.getLayoutMetrics")) as LayoutMetrics;
  const size = metrics.cssContentSize ?? metrics.contentSize ?? { width: 1280, height: 1600 };
  const width = Math.max(1, Math.ceil(size.width));
  const height = Math.min(MAX_SHOT_HEIGHT, Math.max(1, Math.ceil(size.height)));
  const shot = (await send(d, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  })) as { data: string };
  return "data:image/png;base64," + shot.data;
}
