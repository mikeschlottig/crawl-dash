// src/background/reducers.ts
// Pure, chrome-free state transitions. These are the load-bearing logic for
// durable-queue + forced-kill survival, so they are unit-tested in isolation.
import type { JobState, QueueItem, RecordStatus } from "../types";

/**
 * Move every in-flight item back to the front of the queue after a worker restart.
 * Items that have already exhausted their retry budget are dropped (counted failed)
 * to prevent a poison URL from resurrecting the worker forever.
 *
 * Idempotent: a second call on an already-reconciled state is a no-op (inFlight empty),
 * which protects against a double-trigger from concurrent wake sources.
 */
export function reconcileOrphans(state: JobState): { resumed: number; dropped: number } {
  if (state.inFlight.length === 0) return { resumed: 0, dropped: 0 };
  let resumed = 0;
  let dropped = 0;
  // unshift in reverse so original order is preserved at the queue head
  for (let i = state.inFlight.length - 1; i >= 0; i--) {
    const item = state.inFlight[i];
    if (item.attempts < state.config.maxRetries) {
      item.attempts += 1;
      state.queue.unshift(item);
      resumed += 1;
    } else {
      state.progress.done += 1;
      state.progress.failed += 1;
      dropped += 1;
    }
  }
  state.inFlight = [];
  state.progress.inFlight = 0;
  return { resumed, dropped };
}

/**
 * Pull up to (concurrency - inFlight) items from the queue into the in-flight set.
 * Returns the items that should be started now. Mutates state.
 */
export function pullSlots(state: JobState): QueueItem[] {
  if (state.status !== "running") return [];
  const slots = state.config.concurrency - state.inFlight.length;
  const started: QueueItem[] = [];
  for (let i = 0; i < slots && state.queue.length > 0; i++) {
    const item = state.queue.shift()!;
    state.inFlight.push(item);
    started.push(item);
  }
  state.progress.inFlight = state.inFlight.length;
  return started;
}

/** Remove a finished item from in-flight and update counters. Mutates state. */
export function applyFinalize(state: JobState, id: string, status: RecordStatus): void {
  const before = state.inFlight.length;
  state.inFlight = state.inFlight.filter((q) => q.id !== id);
  if (state.inFlight.length === before) return; // already finalized — ignore duplicate
  state.progress.inFlight = state.inFlight.length;
  state.progress.done += 1;
  if (status !== "ok") state.progress.failed += 1;
}

/** True when there is nothing left to do. */
export function isDrained(state: JobState): boolean {
  return state.queue.length === 0 && state.inFlight.length === 0;
}
