import { describe, it, expect } from "vitest";
import { reconcileOrphans, pullSlots, applyFinalize, isDrained } from "../src/background/reducers";
import { initialState, DEFAULT_CONFIG } from "../src/types";
import type { JobState, QueueItem } from "../src/types";

const item = (id: string, attempts = 0): QueueItem => ({ id, url: `https://x/${id}`, attempts });

function running(partial: Partial<JobState> = {}): JobState {
  const s = initialState({ ...DEFAULT_CONFIG, concurrency: 2, maxRetries: 3 });
  s.status = "running";
  return { ...s, ...partial };
}

describe("pullSlots", () => {
  it("fills up to concurrency and moves items to inFlight", () => {
    const s = running({ queue: [item("a"), item("b"), item("c")] });
    const started = pullSlots(s);
    expect(started.map((i) => i.id)).toEqual(["a", "b"]);
    expect(s.inFlight.map((i) => i.id)).toEqual(["a", "b"]);
    expect(s.queue.map((i) => i.id)).toEqual(["c"]);
    expect(s.progress.inFlight).toBe(2);
  });

  it("returns nothing when not running", () => {
    const s = running({ queue: [item("a")], status: "paused" });
    expect(pullSlots(s)).toEqual([]);
  });
});

describe("reconcileOrphans (forced-kill recovery)", () => {
  it("requeues in-flight items to the head, preserving order", () => {
    const s = running({ queue: [item("c")], inFlight: [item("a"), item("b")] });
    const { resumed, dropped } = reconcileOrphans(s);
    expect(resumed).toBe(2);
    expect(dropped).toBe(0);
    expect(s.inFlight).toEqual([]);
    expect(s.queue.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(s.queue[0].attempts).toBe(1); // attempt incremented on requeue
  });

  it("is idempotent — a second call does nothing (guards double wake)", () => {
    const s = running({ inFlight: [item("a")] });
    reconcileOrphans(s);
    const second = reconcileOrphans(s);
    expect(second).toEqual({ resumed: 0, dropped: 0 });
    expect(s.queue.length).toBe(1);
  });

  it("drops poison items past the retry budget instead of resurrecting forever", () => {
    const s = running({ inFlight: [item("poison", 3)] }); // already at maxRetries
    const { resumed, dropped } = reconcileOrphans(s);
    expect(resumed).toBe(0);
    expect(dropped).toBe(1);
    expect(s.queue.length).toBe(0);
    expect(s.progress.failed).toBe(1);
  });
});

describe("applyFinalize", () => {
  it("removes from inFlight and counts done/failed once", () => {
    const s = running({ inFlight: [item("a"), item("b")], progress: { total: 2, done: 0, failed: 0, inFlight: 2 } });
    applyFinalize(s, "a", "ok");
    applyFinalize(s, "b", "http_error");
    expect(s.progress.done).toBe(2);
    expect(s.progress.failed).toBe(1);
    expect(s.inFlight).toEqual([]);
  });

  it("ignores duplicate finalize of the same id", () => {
    const s = running({ inFlight: [item("a")], progress: { total: 1, done: 0, failed: 0, inFlight: 1 } });
    applyFinalize(s, "a", "ok");
    applyFinalize(s, "a", "ok"); // duplicate (e.g. resume race)
    expect(s.progress.done).toBe(1);
  });
});

describe("isDrained", () => {
  it("true only when queue and inFlight are empty", () => {
    expect(isDrained(running())).toBe(true);
    expect(isDrained(running({ inFlight: [item("a")] }))).toBe(false);
    expect(isDrained(running({ queue: [item("a")] }))).toBe(false);
  });
});
