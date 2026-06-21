// src/content/autoscroll.ts
// Injected via chrome.scripting.executeScript. Self-contained. Scrolls to trigger
// lazy-loaded assets, stopping as soon as the page height stabilizes (fast on short
// pages, complete on infinite-scroll ones), with hard caps on time and iterations.
export async function autoScroll() {
  const STEP = 600;
  const INTERVAL = 90;
  const MAX_MS = 15_000;
  const STABLE_TICKS = 6;

  const start = Date.now();
  let lastHeight = 0;
  let stable = 0;

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      window.scrollBy(0, STEP);
      const h = document.documentElement.scrollHeight;
      stable = h === lastHeight ? stable + 1 : 0;
      lastHeight = h;
      const atBottom = window.innerHeight + window.scrollY >= h - 2;
      if ((atBottom && stable >= STABLE_TICKS) || Date.now() - start > MAX_MS) {
        clearInterval(timer);
        window.scrollTo(0, 0); // reset for a clean top-anchored capture
        resolve();
      }
    }, INTERVAL);
  });
}
