// src/background/records.ts — shared record construction used by both engines.
import type { CrawlRecord, QueueItem, RecordStatus, ScrapePayload } from "../types";
import { buildEntity } from "./entity";
import { collectKeywordHits } from "./keywords";

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function makeRecord(args: {
  item: QueueItem;
  status: RecordStatus;
  httpStatus: number | null;
  loadMs: number;
  payload: ScrapePayload | null;
  screenshotRef: string | null;
  contentType: string | null;
  keywordAlerts: string[];
}): CrawlRecord {
  const entity = args.payload ? buildEntity(args.payload) : null;
  return {
    id: args.item.id,
    url: args.item.url,
    hostname: hostnameOf(args.item.url),
    status: args.status,
    attempts: args.item.attempts,
    payload: args.payload,
    entity,
    capture: {
      httpStatus: args.httpStatus,
      loadMs: args.loadMs,
      screenshotRef: args.screenshotRef,
      contentType: args.contentType,
    },
    keywordHits: collectKeywordHits(args.payload, entity, args.keywordAlerts),
    createdAt: new Date().toISOString(),
  };
}

/** Terminal record for a target that exhausted retries (timeout / nav error). */
export function errorRecord(item: QueueItem, err: unknown): CrawlRecord {
  const msg = err instanceof Error ? err.message : String(err);
  const status: RecordStatus = /timeout/i.test(msg) ? "timeout" : "nav_error";
  return {
    id: item.id,
    url: item.url,
    hostname: hostnameOf(item.url),
    status,
    attempts: item.attempts,
    payload: null,
    entity: null,
    capture: { httpStatus: null, loadMs: 0, screenshotRef: null, contentType: null },
    keywordHits: [],
    createdAt: new Date().toISOString(),
  };
}
