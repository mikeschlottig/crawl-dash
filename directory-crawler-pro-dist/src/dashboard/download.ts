// src/dashboard/download.ts — trigger a file download from the dashboard window.
// Uses a Blob + anchor; needs no extra permission since the dashboard is a normal page.
import type { ExportResult } from "./exporters";

export function triggerDownload(result: ExportResult): void {
  const blob = new Blob([result.content], { type: result.mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
