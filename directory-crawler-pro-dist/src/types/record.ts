// src/types/record.ts
export type RecordStatus = "ok" | "http_error" | "timeout" | "nav_error";
export type CrawlEngine = "render" | "fetch";
export type EntitySource = "json-ld" | "microdata" | "heuristic" | "none";

export interface ContactInfo {
  emails: string[];
  phones: string[];
  socialLinks: string[];
}

export interface Headings {
  h1: string[];
  h2: string[];
  h3: string[];
}

export interface MicrodataItem {
  type: string;
  props: Record<string, string[]>;
}

export interface LinkStats {
  internal: number;
  external: number;
  sampleExternalHosts: string[];
}

export interface ScrapePayload {
  title: string;
  description: string;
  contactInfo: ContactInfo;
  headings: Headings;
  metaTags: Record<string, string>;
  jsonLdSchemas: unknown[];
  microdata: MicrodataItem[];
  potentialSitemaps: string[];
  canonical: string;
  lang: string;
  robots: string;
  wordCount: number;
  links: LinkStats;
  /** Convenience mirror of contactInfo.emails (kept for back-compat with P1). */
  emails: string[];
  engine: CrawlEngine;
  capturedAt: string; // ISO
}

// ---- normalized business entity (P3) ----
export interface PostalAddress {
  streetAddress: string;
  locality: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface OpeningHours {
  days: string[];
  opens: string;
  closes: string;
}

export interface AggregateRating {
  value: number;
  count: number;
}

export interface BusinessEntity {
  name: string;
  legalName: string;
  types: string[];
  description: string;
  categories: string[];
  telephones: string[];
  emails: string[];
  address: PostalAddress | null;
  geo: GeoPoint | null;
  openingHours: OpeningHours[];
  openingHoursText: string[];
  priceRange: string;
  rating: AggregateRating | null;
  sameAs: string[];
  logo: string;
  images: string[];
  url: string;
  source: EntitySource;
  confidence: number; // 0..1
}

export interface CaptureMeta {
  httpStatus: number | null;
  loadMs: number;
  /** Storage key (shot:<id>) of the screenshot data URL, or null. */
  screenshotRef: string | null;
  /** Detected MIME type of the main document. */
  contentType: string | null;
}

export interface CrawlRecord {
  id: string; // hash(url)
  url: string;
  hostname: string;
  status: RecordStatus;
  attempts: number;
  payload: ScrapePayload | null;
  entity: BusinessEntity | null;
  capture: CaptureMeta;
  keywordHits: string[];
  createdAt: string; // ISO
}

export function emptyPayload(engine: CrawlEngine): ScrapePayload {
  return {
    title: "",
    description: "",
    contactInfo: { emails: [], phones: [], socialLinks: [] },
    headings: { h1: [], h2: [], h3: [] },
    metaTags: {},
    jsonLdSchemas: [],
    microdata: [],
    potentialSitemaps: [],
    canonical: "",
    lang: "",
    robots: "",
    wordCount: 0,
    links: { internal: 0, external: 0, sampleExternalHosts: [] },
    emails: [],
    engine,
    capturedAt: new Date().toISOString(),
  };
}

export function emptyEntity(): BusinessEntity {
  return {
    name: "",
    legalName: "",
    types: [],
    description: "",
    categories: [],
    telephones: [],
    emails: [],
    address: null,
    geo: null,
    openingHours: [],
    openingHoursText: [],
    priceRange: "",
    rating: null,
    sameAs: [],
    logo: "",
    images: [],
    url: "",
    source: "none",
    confidence: 0,
  };
}
