// src/popup/popup.ts — single job: open (or focus) the detached control-center window.
const KEY = "dashboardWindowId";

document.getElementById("open")!.addEventListener("click", async () => {
  const got = await chrome.storage.session.get(KEY);
  const existing = got[KEY] as number | undefined;
  if (existing != null) {
    try {
      await chrome.windows.update(existing, { focused: true });
      window.close();
      return;
    } catch {
      /* stale id — recreate below */
    }
  }
  const win = await chrome.windows.create({
    url: "dist/dashboard.html",
    type: "popup",
    width: 1180,
    height: 820,
    focused: true,
  });
  if (win.id != null) await chrome.storage.session.set({ [KEY]: win.id });
  window.close();
});
