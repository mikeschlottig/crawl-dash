// src/background/index.ts — service worker entrypoint.
// Listeners are registered SYNCHRONOUSLY at top level (MV3 requirement) so the worker
// can be woken by any of them. resumeIfNeeded() runs on every wake to recover a crawl
// that was interrupted by a forced termination.
import type { InboundMessage, Snapshot } from "../types";
import { assertNever } from "../types";
import { startCrawl, pause, resume, resumeIfNeeded } from "./orchestrator";
import { readState, readConfig, writeConfig, clearRecords, listRecords, readLogs, getScreenshot } from "./store";
import { releaseKeepAlive } from "./keepalive";
import { log, emitStatus } from "./bus";

const RESUME_ALARM = "resume-watchdog";

// ---- lifecycle wakes ----
chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(RESUME_ALARM, { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  void resumeIfNeeded();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RESUME_ALARM) void resumeIfNeeded();
});

// ---- message router ----
chrome.runtime.onMessage.addListener((msg: InboundMessage, _sender, sendResponse) => {
  // The keepalive ping doubles as a wake-resume trigger.
  if (msg.kind === "__KEEPALIVE__") {
    void resumeIfNeeded();
    return false;
  }

  void (async () => {
    try {
      switch (msg.kind) {
        case "START_CRAWL":
          await writeConfig(msg.config);
          await startCrawl(msg.urls, msg.config);
          sendResponse({ ok: true });
          break;
        case "PAUSE_CRAWL":
          await pause();
          sendResponse({ ok: true });
          break;
        case "RESUME_CRAWL":
          await resume();
          sendResponse({ ok: true });
          break;
        case "CLEAR_HISTORY":
          await clearRecords();
          await releaseKeepAlive();
          await log("info", "History cleared.");
          await emitStatus();
          sendResponse({ ok: true });
          break;
        case "GET_SNAPSHOT": {
          sendResponse(await buildSnapshot());
          break;
        }
        case "GET_SCREENSHOT": {
          sendResponse({ dataUrl: await getScreenshot(msg.ref) });
          break;
        }
        default:
          assertNever(msg);
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true; // async sendResponse
});

async function buildSnapshot(): Promise<Snapshot> {
  const [state, records, logs, config] = await Promise.all([
    readState(),
    listRecords(),
    readLogs(),
    readConfig(),
  ]);
  return { status: state.status, progress: state.progress, config, records, logs };
}

// Cold-start recovery: if the worker respawned mid-crawl, pick up immediately.
void resumeIfNeeded();
