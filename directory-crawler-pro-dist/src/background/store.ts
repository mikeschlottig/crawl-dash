// src/background/store.ts
// Typed wrapper over chrome.storage. State lives in `session` (survives SW restarts
// within a browser session); records/config/logs live in `local` (durable).
// All JobState read-modify-write goes through updateState(), serialized by a promise
// chain so concurrent runItem() finalizes within one SW instance never clobber.
import type { CrawlRecord, JobConfig, JobState, LogEntry } from "../types";
import { DEFAULT_CONFIG, initialState } from "../types";

const K_STATE = "job:state";
const K_CONFIG = "cfg:default";
const K_LOGS = "log:buffer";
const REC_PREFIX = "rec:";
const SHOT_PREFIX = "shot:";
const LOG_CAP = 200;

export async function readState(): Promise<JobState> {
  const got = await chrome.storage.session.get(K_STATE);
  const s = got[K_STATE] as JobState | undefined;
  if (s) return s;
  const cfg = await readConfig();
  return initialState(cfg);
}

async function writeState(state: JobState): Promise<void> {
  await chrome.storage.session.set({ [K_STATE]: state });
}

// ---- serialized mutation ----
let chain: Promise<unknown> = Promise.resolve();

export function updateState<T>(mutator: (s: JobState) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const s = await readState();
    const result = await mutator(s);
    await writeState(s);
    return result;
  });
  // keep the chain alive regardless of individual failures
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}

// ---- config ----
export async function readConfig(): Promise<JobConfig> {
  const got = await chrome.storage.local.get(K_CONFIG);
  return (got[K_CONFIG] as JobConfig | undefined) ?? { ...DEFAULT_CONFIG };
}

export async function writeConfig(config: JobConfig): Promise<void> {
  await chrome.storage.local.set({ [K_CONFIG]: config });
}

// ---- records ----
export async function putRecord(rec: CrawlRecord): Promise<void> {
  await chrome.storage.local.set({ [REC_PREFIX + rec.id]: rec });
}

export async function listRecords(): Promise<CrawlRecord[]> {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(REC_PREFIX))
    .map((k) => all[k] as CrawlRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function clearRecords(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(REC_PREFIX) || k.startsWith(SHOT_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  await chrome.storage.session.remove(K_LOGS);
}

// ---- screenshots (stored apart from records so metadata queries stay light) ----
export async function putScreenshot(recordId: string, dataUrl: string): Promise<string> {
  const key = SHOT_PREFIX + recordId;
  await chrome.storage.local.set({ [key]: dataUrl });
  return key;
}

export async function getScreenshot(ref: string): Promise<string | null> {
  const got = await chrome.storage.local.get(ref);
  return (got[ref] as string | undefined) ?? null;
}

// ---- logs (volatile, capped, replayed on dashboard reconnect) ----
export async function appendLog(entry: LogEntry): Promise<void> {
  const got = await chrome.storage.session.get(K_LOGS);
  const buf = ((got[K_LOGS] as LogEntry[] | undefined) ?? []).concat(entry);
  await chrome.storage.session.set({ [K_LOGS]: buf.slice(-LOG_CAP) });
}

export async function readLogs(): Promise<LogEntry[]> {
  const got = await chrome.storage.session.get(K_LOGS);
  return (got[K_LOGS] as LogEntry[] | undefined) ?? [];
}
