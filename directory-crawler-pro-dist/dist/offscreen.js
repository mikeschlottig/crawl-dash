// src/offscreen/offscreen.ts
var PING_MS = 2e4;
setInterval(() => {
  chrome.runtime.sendMessage({ kind: "__KEEPALIVE__" }).catch(() => void 0);
}, PING_MS);
//# sourceMappingURL=offscreen.js.map
