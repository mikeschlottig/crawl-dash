// src/background/engine.ts — selects the crawl engine and provides a graceful fallback.
import type { CrawlRecord, JobConfig, QueueItem } from "../types";
import { PermanentError } from "./retry";
import { renderEngine, closeCrawlerWindow } from "./capture";
import { fetchEngine } from "./fetcher";

export { closeCrawlerWindow };

/**
 * Run the configured engine for one target. If the render engine cannot attach the
 * debugger (e.g. restricted pages, or debugger contention), fall back to the fetch
 * engine for this single attempt rather than failing the target outright. A carried
 * record (http_error) is preserved by re-throwing the original error.
 */
export async function runEngine(item: QueueItem, config: JobConfig): Promise<CrawlRecord> {
  if (config.engine === "fetch") return fetchEngine(item, config);
  try {
    return await renderEngine(item, config);
  } catch (err) {
    // A classified HTTP result must not be downgraded — propagate so retry/finalize see it.
    if (err instanceof PermanentError && err.record) throw err;
    if (isAttachFailure(err)) return fetchEngine(item, config);
    throw err;
  }
}

function isAttachFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("cannot access") ||
    msg.includes("another debugger") ||
    msg.includes("cannot attach") ||
    msg.includes("devtools") ||
    msg.includes("not attached")
  );
}
