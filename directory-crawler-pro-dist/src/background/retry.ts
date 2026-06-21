// src/background/retry.ts — exponential backoff + decorrelated jitter, classified errors.
import type { CrawlRecord } from "../types";

/**
 * Failure that must NOT be retried (a real 404, blocked domain).
 * May carry a finished record so the caller can persist it without a retry.
 */
export class PermanentError extends Error {
  readonly retryable = false;
  constructor(
    message: string,
    public readonly record?: CrawlRecord,
  ) {
    super(message);
    this.name = "PermanentError";
  }
}

/**
 * Failure that SHOULD be retried (timeout, transient 5xx, network blip).
 * May carry a partial record used if every attempt is exhausted.
 */
export class TransientError extends Error {
  readonly retryable = true;
  constructor(
    message: string,
    public readonly record?: CrawlRecord,
  ) {
    super(message);
    this.name = "TransientError";
  }
}

export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  jitterRatio?: number;
  /** Injectable sleep — overridden in tests so they run instantly. */
  sleep?: (ms: number) => Promise<void>;
}

export function computeDelay(
  attempt: number,
  baseMs: number,
  capMs: number,
  jitterRatio: number,
  rand: () => number = Math.random,
): number {
  const exp = Math.min(baseMs * 2 ** (attempt - 1), capMs);
  return exp + rand() * exp * jitterRatio;
}

function isNonRetryable(err: unknown): boolean {
  return err instanceof Error && (err as { retryable?: boolean }).retryable === false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  opts: BackoffOptions = {},
): Promise<T> {
  const baseMs = opts.baseMs ?? 1000;
  const capMs = opts.capMs ?? 15_000;
  const jitterRatio = opts.jitterRatio ?? 0.3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isNonRetryable(err)) throw err;
      if (attempt === maxAttempts) break;
      await sleep(computeDelay(attempt, baseMs, capMs, jitterRatio));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Pull a carried record off an error, if present. */
export function recordFromError(err: unknown): CrawlRecord | undefined {
  if (err instanceof PermanentError || err instanceof TransientError) return err.record;
  return undefined;
}
