// src/types/messages.ts
import type { JobConfig, JobProgress, JobStatus } from "./job";
import type { CrawlRecord } from "./record";

export type ExportFormat = "json" | "jsonl" | "csv" | "md" | "html";
export type LogLevel = "info" | "warn" | "error" | "success";

export interface LogEntry {
  level: LogLevel;
  text: string;
  ts: number;
}

/** Messages the dashboard/popup send to the service worker. */
export type DashboardMessage =
  | { kind: "START_CRAWL"; urls: string[]; config: JobConfig }
  | { kind: "PAUSE_CRAWL" }
  | { kind: "RESUME_CRAWL" }
  | { kind: "CLEAR_HISTORY" }
  | { kind: "GET_SNAPSHOT" }
  | { kind: "GET_SCREENSHOT"; ref: string };

/** Internal wake signal sent by the offscreen keepalive document. */
export interface KeepAliveMessage {
  kind: "__KEEPALIVE__";
}

export type InboundMessage = DashboardMessage | KeepAliveMessage;

/** Events the service worker emits to any open dashboard. */
export type WorkerEvent =
  | { kind: "STATUS"; status: JobStatus; progress: JobProgress }
  | { kind: "LOG"; entry: LogEntry }
  | { kind: "RECORD_DONE"; record: CrawlRecord }
  | { kind: "KEYWORD_HIT"; recordId: string; hostname: string; terms: string[] };

export interface Snapshot {
  status: JobStatus;
  progress: JobProgress;
  config: JobConfig;
  records: CrawlRecord[];
  logs: LogEntry[];
}

/** Compile-time exhaustiveness guard. */
export function assertNever(x: never): never {
  throw new Error("Unhandled variant: " + JSON.stringify(x));
}
