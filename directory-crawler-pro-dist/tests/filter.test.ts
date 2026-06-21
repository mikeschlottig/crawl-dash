import { describe, it, expect } from "vitest";
import { passesDomainFilter } from "../src/background/filter";

describe("passesDomainFilter", () => {
  it("allows everything when allowlist empty", () => {
    expect(passesDomainFilter("https://anything.com/x", [])).toBe(true);
  });

  it("matches exact host", () => {
    expect(passesDomainFilter("https://example.com/page", ["example.com"])).toBe(true);
  });

  it("matches subdomain via true suffix", () => {
    expect(passesDomainFilter("https://shop.example.com", ["example.com"])).toBe(true);
  });

  it("rejects substring-spoofed lookalike domains", () => {
    expect(passesDomainFilter("https://example.com.attacker.io", ["example.com"])).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(passesDomainFilter("not a url", ["example.com"])).toBe(false);
  });

  it("handles wildcard and leading-dot syntaxes", () => {
    expect(passesDomainFilter("https://a.example.com", ["*.example.com"])).toBe(true);
    expect(passesDomainFilter("https://example.com", [".example.com"])).toBe(true);
  });
});
