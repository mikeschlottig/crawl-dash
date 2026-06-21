// src/background/bus.ts — fan out events to any open dashboard; persist logs for replay.
import type { LogLevel, WorkerEvent } from "../types";
import { appendLog, readState } from "./store";

export function emit(event: WorkerEvent): void {
  // No receiver (dashboard closed) rejects — that is expected and harmless.
  chrome.runtime.sendMessage(event).catch(() => undefined);
}

export async function log(level: LogLevel, text: string): Promise<void> {
  const entry = { level, text, ts: Date.now() };
  await appendLog(entry);
  emit({ kind: "LOG", entry });
}

export async function emitStatus(): Promise<void> {
  const s = await readState();
  emit({ kind: "STATUS", status: s.status, progress: s.progress });
}
