import { describe, it, expect, vi } from "vitest";
import { withRetry, PermanentError, TransientError, computeDelay } from "../src/background/retry";
import { hashUrl } from "../src/background/hash";

const noSleep = () => Promise.resolve();

describe("withRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, 3, { sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient errors up to maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(new TransientError("boom"));
    await expect(withRetry(fn, 3, { sleep: noSleep })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry permanent errors", async () => {
    const fn = vi.fn().mockRejectedValue(new PermanentError("404"));
    await expect(withRetry(fn, 3, { sleep: noSleep })).rejects.toBeInstanceOf(PermanentError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("eventually succeeds after transient failures", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TransientError("1"))
      .mockResolvedValue("done");
    await expect(withRetry(fn, 3, { sleep: noSleep })).resolves.toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("computeDelay", () => {
  it("grows exponentially and caps", () => {
    const z = () => 0; // no jitter
    expect(computeDelay(1, 1000, 15000, 0.3, z)).toBe(1000);
    expect(computeDelay(2, 1000, 15000, 0.3, z)).toBe(2000);
    expect(computeDelay(10, 1000, 15000, 0.3, z)).toBe(15000); // capped
  });
});

describe("hashUrl", () => {
  it("is deterministic", () => {
    expect(hashUrl("https://a.com/x")).toBe(hashUrl("https://a.com/x"));
  });
  it("distinguishes different pages on the same host (no collision overwrite)", () => {
    expect(hashUrl("https://a.com/1")).not.toBe(hashUrl("https://a.com/2"));
  });
});
