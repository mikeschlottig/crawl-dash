// src/background/keepalive.ts — offscreen document keeps the SW alive during a crawl.
const OFFSCREEN_URL = "dist/offscreen.html";

export async function ensureKeepAlive(): Promise<void> {
  // hasDocument is available Chrome 116+; guard defensively anyway.
  if (typeof chrome.offscreen?.hasDocument === "function") {
    if (await chrome.offscreen.hasDocument()) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "Keep the crawl orchestrator alive during long-running jobs.",
    });
  } catch {
    // Already exists or race — safe to ignore.
  }
}

export async function releaseKeepAlive(): Promise<void> {
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch {
    /* nothing to close */
  }
}
