// src/offscreen/offscreen.ts — pings the service worker to reset its idle timer.
// 20s < the ~30s MV3 idle threshold, with margin. Each ping also wakes a dead SW,
// which then runs resumeIfNeeded() — the secondary forced-kill recovery trigger.
const PING_MS = 20_000;

setInterval(() => {
  chrome.runtime.sendMessage({ kind: "__KEEPALIVE__" }).catch(() => undefined);
}, PING_MS);
