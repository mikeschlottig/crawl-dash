// src/types/job.ts
import type { CrawlEngine } from "./record";

export type JobStatus = "idle" | "running" | "paused";

export interface JobConfig {
  /** Per-page watchdog timeout in ms. */
  timeoutMs: number;
  /** Parallel in-flight targets. */
  concurrency: number;
  /** Politeness delay applied between pool top-ups (ms). */
  perHostDelayMs: number;
  /** Minimum attempts on transient failure (>= 3 per standard). */
  maxRetries: number;
  /** Suffix-matched allowlist; empty array = all domains allowed. */
  allowedDomains: string[];
  /** Industry terms flagged on each record (e.g. HVAC, Plumbing, Lawyer). */
  keywordAlerts: string[];
  /** "render" = CDP rendered capture + screenshot; "fetch" = lightweight HTTP fetch. */
  engine: CrawlEngine;
  /** Full-page screenshot via captureBeyondViewport (render engine only). */
  fullPageScreenshot: boolean;
}

export interface QueueItem {
  /** Stable hash of the full URL — collision-safe record key. */
  id: string;
  url: string;
  /** How many times this item has entered the pool (incl. forced-kill requeues). */
  attempts: number;
}

export interface JobProgress {
  total: number;
  done: number;
  failed: number;
  inFlight: number;
}

export interface JobState {
  status: JobStatus;
  config: JobConfig;
  /** Pending targets. */
  queue: QueueItem[];
  /** Targets currently being processed. Persisted so a killed SW can reconcile orphans. */
  inFlight: QueueItem[];
  progress: JobProgress;
}

export const DEFAULT_CONFIG: JobConfig = {
  timeoutMs: 30_000,
  concurrency: 3,
  perHostDelayMs: 600,
  maxRetries: 3,
  allowedDomains: [],
  keywordAlerts: [],
  engine: "render",
  fullPageScreenshot: true,
};

export const EMPTY_PROGRESS: JobProgress = { total: 0, done: 0, failed: 0, inFlight: 0 };

export function initialState(config: JobConfig = DEFAULT_CONFIG): JobState {
  return { status: "idle", config, queue: [], inFlight: [], progress: { ...EMPTY_PROGRESS } };
}
