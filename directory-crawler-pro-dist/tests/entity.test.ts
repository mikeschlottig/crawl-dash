import { describe, it, expect } from "vitest";
import { buildEntity, formatAddress } from "../src/background/entity";
import { emptyPayload } from "../src/types";
import type { ScrapePayload } from "../src/types";

function withJsonLd(schemas: unknown[]): ScrapePayload {
  const p = emptyPayload("render");
  p.jsonLdSchemas = schemas;
  return p;
}

describe("buildEntity — JSON-LD", () => {
  it("parses a flat LocalBusiness subtype with address, geo, hours, rating", () => {
    const e = buildEntity(
      withJsonLd([
        {
          "@context": "https://schema.org",
          "@type": "Plumber",
          name: "Rogue Valley Plumbing",
          telephone: "+1-541-555-0100",
          priceRange: "$$",
          address: {
            "@type": "PostalAddress",
            streetAddress: "123 Main St",
            addressLocality: "Grants Pass",
            addressRegion: "OR",
            postalCode: "97526",
            addressCountry: "US",
          },
          geo: { "@type": "GeoCoordinates", latitude: 42.4393, longitude: -123.3284 },
          openingHoursSpecification: [
            { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday"], opens: "08:00", closes: "17:00" },
          ],
          aggregateRating: { "@type": "AggregateRating", ratingValue: "4.8", reviewCount: "212" },
          sameAs: ["https://facebook.com/rvplumbing"],
        },
      ]),
    );
    expect(e.source).toBe("json-ld");
    expect(e.name).toBe("Rogue Valley Plumbing");
    expect(e.types).toContain("Plumber");
    expect(e.telephones).toEqual(["+15415550100"]);
    expect(e.address?.locality).toBe("Grants Pass");
    expect(e.geo).toEqual({ lat: 42.4393, lng: -123.3284 });
    expect(e.openingHours[0]).toEqual({ days: ["Monday", "Tuesday"], opens: "08:00", closes: "17:00" });
    expect(e.rating).toEqual({ value: 4.8, count: 212 });
    expect(e.priceRange).toBe("$$");
    expect(e.confidence).toBeGreaterThan(0.7);
  });

  it("digs the business node out of an @graph", () => {
    const e = buildEntity(
      withJsonLd([
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "WebSite", name: "ignore me" },
            { "@type": "BreadcrumbList" },
            { "@type": ["LocalBusiness", "HVACBusiness"], name: "Cascade Heating", telephone: "5415551234" },
          ],
        },
      ]),
    );
    expect(e.name).toBe("Cascade Heating");
    expect(e.types).toContain("HVACBusiness");
    expect(e.telephones).toEqual(["5415551234"]);
  });

  it("prefers the higher-scoring business node when several exist", () => {
    const e = buildEntity(
      withJsonLd([
        { "@type": "Organization", name: "Bare Org" },
        {
          "@type": "Restaurant",
          name: "Full Restaurant",
          telephone: "1112223333",
          address: { "@type": "PostalAddress", streetAddress: "1 Food Way", addressLocality: "Medford" },
        },
      ]),
    );
    expect(e.name).toBe("Full Restaurant");
    expect(e.types).toContain("Restaurant");
  });

  it("handles openingHours text shorthand and string dayOfWeek with URL prefix", () => {
    const e = buildEntity(
      withJsonLd([
        {
          "@type": "Store",
          name: "Shorthand Shop",
          openingHours: ["Mo-Fr 09:00-17:00", "Sa 10:00-16:00"],
          openingHoursSpecification: { dayOfWeek: "https://schema.org/Sunday", opens: "12:00", closes: "16:00" },
        },
      ]),
    );
    expect(e.openingHoursText).toEqual(["Mo-Fr 09:00-17:00", "Sa 10:00-16:00"]);
    expect(e.openingHours[0]).toEqual({ days: ["Sunday"], opens: "12:00", closes: "16:00" });
  });
});

describe("buildEntity — microdata fallback", () => {
  it("uses microdata when no JSON-LD business node is present", () => {
    const p = emptyPayload("render");
    p.microdata = [
      {
        type: "https://schema.org/LocalBusiness",
        props: {
          name: ["Microdata Cafe"],
          telephone: ["541-555-9999"],
          streetAddress: ["55 Bean Blvd"],
          addressLocality: ["Ashland"],
          postalCode: ["97520"],
        },
      },
    ];
    const e = buildEntity(p);
    expect(e.source).toBe("microdata");
    expect(e.name).toBe("Microdata Cafe");
    expect(e.address?.locality).toBe("Ashland");
    expect(e.telephones).toEqual(["5415559999"]);
  });
});

describe("buildEntity — heuristic top-up", () => {
  it("falls back to OG/meta + scraped contacts and marks low confidence", () => {
    const p = emptyPayload("fetch");
    p.title = "Joe's Garage";
    p.metaTags["og:site_name"] = "Joe's Garage";
    p.contactInfo.emails = ["info@joesgarage.com", "tracking@sentry.io"];
    p.contactInfo.phones = ["(541) 555-7777"];
    p.contactInfo.socialLinks = ["https://facebook.com/joesgarage"];
    const e = buildEntity(p);
    expect(e.source).toBe("heuristic");
    expect(e.name).toBe("Joe's Garage");
    expect(e.emails).toEqual(["info@joesgarage.com"]); // sentry junk filtered
    expect(e.telephones).toEqual(["5415557777"]);
    expect(e.sameAs).toEqual(["https://facebook.com/joesgarage"]);
    expect(e.confidence).toBeLessThan(0.5);
  });

  it("returns source 'none' with zero confidence for an empty page", () => {
    const e = buildEntity(emptyPayload("render"));
    expect(e.source).toBe("none");
    expect(e.confidence).toBe(0);
  });
});

describe("formatAddress", () => {
  it("joins present fields, skips blanks", () => {
    expect(
      formatAddress({ streetAddress: "1 A St", locality: "Town", region: "OR", postalCode: "97000", country: "" }),
    ).toBe("1 A St, Town, OR, 97000");
    expect(formatAddress(null)).toBe("");
  });
});
