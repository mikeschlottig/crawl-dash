import { describe, it, expect } from "vitest";
import { cleanEmails, normalizePhone, dedupePhones, normalizeUrl, dedupeUrls, dayName, isHtmlType } from "../src/background/normalize";

describe("cleanEmails", () => {
  it("validates, lowercases, dedupes and drops junk", () => {
    expect(
      cleanEmails(["Info@Example-biz.com", "info@example-biz.com", "tracking@sentry.io", "logo@2x.png", "bad@@x"]),
    ).toEqual(["info@example-biz.com"]);
  });
});

describe("normalizePhone / dedupePhones", () => {
  it("keeps leading + and digits, rejects too-short", () => {
    expect(normalizePhone("+1 (541) 555-0100")).toBe("+15415550100");
    expect(normalizePhone("12345")).toBe("");
  });
  it("dedupes by normalized form", () => {
    expect(dedupePhones(["541-555-0100", "(541) 555 0100", "5415550100"])).toEqual(["5415550100"]);
  });
  it("collapses +country-code and bare forms, preferring the + form", () => {
    expect(dedupePhones(["+1 (541) 555-2210", "541-555-2210"])).toEqual(["+15415552210"]);
    expect(dedupePhones(["5415552210", "+15415552210"])).toEqual(["+15415552210"]);
  });
});

describe("normalizeUrl / dedupeUrls", () => {
  it("strips query/hash/trailing slash for comparison but keeps original", () => {
    expect(normalizeUrl("https://Facebook.com/Page/?ref=1#x")).toBe("https://facebook.com/page");
    expect(dedupeUrls(["https://x.com/a", "https://x.com/a/", "https://x.com/a?b=1"])).toEqual(["https://x.com/a"]);
  });
});

describe("dayName", () => {
  it("strips schema.org URL prefix", () => {
    expect(dayName("https://schema.org/Monday")).toBe("Monday");
    expect(dayName("Tuesday")).toBe("Tuesday");
  });
});

describe("isHtmlType", () => {
  it("treats unknown as html, detects non-html", () => {
    expect(isHtmlType(null)).toBe(true);
    expect(isHtmlType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlType("application/pdf")).toBe(false);
    expect(isHtmlType("image/png")).toBe(false);
  });
});
