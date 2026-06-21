import { describe, it, expect } from "vitest";
import { hostnameOf, makeRecord, errorRecord } from "../src/background/records";
import { scanKeywords } from "../src/background/keywords";
import { emptyPayload } from "../src/types";
import type { QueueItem } from "../src/types";

const item: QueueItem = { id: "abc", url: "https://shop.example.com/store", attempts: 1 };

describe("hostnameOf", () => {
  it("extracts hostname", () => {
    expect(hostnameOf("https://shop.example.com/x")).toBe("shop.example.com");
  });
  it("returns input on malformed url", () => {
    expect(hostnameOf("garbage")).toBe("garbage");
  });
});

describe("makeRecord", () => {
  it("builds an ok record with keyword hits from headings", () => {
    const payload = emptyPayload("render");
    payload.title = "Best HVAC in town";
    payload.headings.h2 = ["Emergency Plumbing service"];
    const rec = makeRecord({
      item,
      status: "ok",
      httpStatus: 200,
      loadMs: 123,
      payload,
      screenshotRef: "shot:abc",
      contentType: "text/html",
      keywordAlerts: ["hvac", "plumbing", "lawyer"],
    });
    expect(rec.status).toBe("ok");
    expect(rec.hostname).toBe("shop.example.com");
    expect(rec.capture.screenshotRef).toBe("shot:abc");
    expect(rec.keywordHits.sort()).toEqual(["hvac", "plumbing"]);
    expect(rec.attempts).toBe(1);
  });
});

describe("errorRecord", () => {
  it("classifies timeouts", () => {
    expect(errorRecord(item, new Error("timeout 30000ms")).status).toBe("timeout");
  });
  it("classifies everything else as nav_error", () => {
    expect(errorRecord(item, new Error("ECONNREFUSED")).status).toBe("nav_error");
  });
});

describe("scanKeywords across headings", () => {
  it("finds terms in h1/h2/h3 and title", () => {
    const p = emptyPayload("render");
    p.headings.h3 = ["Family Lawyer near you"];
    expect(scanKeywords(p, ["lawyer"])).toEqual(["lawyer"]);
  });
  it("returns empty for null payload", () => {
    expect(scanKeywords(null, ["x"])).toEqual([]);
  });
});
