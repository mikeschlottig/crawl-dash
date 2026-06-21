// src/background/entity.ts
// Pure normalizer: turns a raw ScrapePayload into a structured BusinessEntity by merging
// JSON-LD (primary), microdata (secondary) and OpenGraph/meta + scraped contacts
// (tertiary). Fully unit-tested; no chrome, no DOM.
import type {
  AggregateRating,
  BusinessEntity,
  GeoPoint,
  MicrodataItem,
  OpeningHours,
  PostalAddress,
  ScrapePayload,
} from "../types";
import { emptyEntity } from "../types";
import { cleanEmails, dedupePhones, dedupeUrls, dayName, toNumber } from "./normalize";

type Node = Record<string, unknown>;

const BUSINESS_RE =
  /(business|organization|store|shop|restaurant|cafe|bar|hotel|lodging|service|dentist|physician|hospital|plumber|electrician|contractor|hvac|roofing|lawyer|attorney|legalservice|realestate|agent|salon|spa|gym|company|corporation|professional|automotive|repair|clinic|pharmacy|bakery|brewery)/i;
const EXCLUDE_RE = /(website|webpage|breadcrumb|searchaction|listitem|imageobject|videoobject|article|collectionpage)/i;

// ---- JSON-LD traversal ----
function flatten(nodes: unknown[]): Node[] {
  const out: Node[] = [];
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (n && typeof n === "object") {
      const o = n as Node;
      if (Array.isArray(o["@graph"])) (o["@graph"] as unknown[]).forEach(visit);
      out.push(o);
    }
  };
  nodes.forEach(visit);
  return out;
}

function typeList(o: Node): string[] {
  const t = o["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

function looksLikeBusiness(o: Node): boolean {
  const types = typeList(o);
  const typeStr = types.join(" ");
  if (types.length && EXCLUDE_RE.test(typeStr) && !o["address"]) return false;
  if (BUSINESS_RE.test(typeStr)) return true;
  return Boolean(o["address"] || o["telephone"] || o["geo"]);
}

function scoreNode(o: Node): number {
  let s = 0;
  if (str(o["name"])) s += 3;
  if (o["address"]) s += 3;
  if (o["telephone"]) s += 2;
  if (o["geo"]) s += 1;
  if (o["openingHoursSpecification"] || o["openingHours"]) s += 1;
  if (o["aggregateRating"]) s += 1;
  if (o["sameAs"]) s += 1;
  const types = typeList(o).join(" ");
  if (BUSINESS_RE.test(types) && !/^organization$/i.test(types)) s += 2; // prefer specific subtype
  return s;
}

// ---- field coercion ----
function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

function strArray(v: unknown): string[] {
  if (typeof v === "string") return [v.trim()].filter(Boolean);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x.trim() : str(x))).filter(Boolean);
  return [];
}

function firstObj(v: unknown): Node | null {
  if (Array.isArray(v)) return (v.find((x) => x && typeof x === "object") as Node) ?? null;
  if (v && typeof v === "object") return v as Node;
  return null;
}

function parseAddress(v: unknown): PostalAddress | null {
  const a = firstObj(v);
  if (a) {
    const country = typeof a["addressCountry"] === "object" ? str((a["addressCountry"] as Node)["name"]) : str(a["addressCountry"]);
    const addr: PostalAddress = {
      streetAddress: str(a["streetAddress"]),
      locality: str(a["addressLocality"]),
      region: str(a["addressRegion"]),
      postalCode: str(a["postalCode"]),
      country,
    };
    return addr.streetAddress || addr.locality || addr.postalCode ? addr : null;
  }
  return null;
}

function parseGeo(v: unknown): GeoPoint | null {
  const g = firstObj(v);
  if (!g) return null;
  const lat = toNumber(g["latitude"]);
  const lng = toNumber(g["longitude"]);
  return lat !== null && lng !== null ? { lat, lng } : null;
}

function parseHours(v: unknown): OpeningHours[] {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  const out: OpeningHours[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Node;
    const days = strArray(o["dayOfWeek"]).map(dayName);
    const opens = str(o["opens"]);
    const closes = str(o["closes"]);
    if (opens || closes || days.length) out.push({ days, opens, closes });
  }
  return out;
}

function parseRating(v: unknown): AggregateRating | null {
  const r = firstObj(v);
  if (!r) return null;
  const value = toNumber(r["ratingValue"]);
  const count = toNumber(r["reviewCount"]) ?? toNumber(r["ratingCount"]);
  return value !== null ? { value, count: count ?? 0 } : null;
}

// ---- microdata fallback ----
function microdataBusiness(items: MicrodataItem[]): Node | null {
  const biz = items.find((i) => BUSINESS_RE.test(i.type) && !EXCLUDE_RE.test(i.type));
  if (!biz) return null;
  const get = (k: string) => biz.props[k]?.[0] ?? "";
  const node: Node = {
    "@type": biz.type.split("/").pop() ?? "LocalBusiness",
    name: get("name"),
    telephone: get("telephone"),
    email: get("email"),
    priceRange: get("priceRange"),
  };
  const street = get("streetAddress");
  if (street || get("addressLocality") || get("postalCode")) {
    node["address"] = {
      streetAddress: street,
      addressLocality: get("addressLocality"),
      addressRegion: get("addressRegion"),
      postalCode: get("postalCode"),
      addressCountry: get("addressCountry"),
    };
  }
  return node;
}

// ---- confidence ----
function confidence(e: BusinessEntity): number {
  let c = 0;
  if (e.name) c += 0.2;
  if (e.address && (e.address.streetAddress || e.address.locality)) c += 0.2;
  if (e.telephones.length) c += 0.15;
  if (e.geo) c += 0.1;
  if (e.openingHours.length || e.openingHoursText.length) c += 0.1;
  if (e.rating) c += 0.1;
  if (e.types.some((t) => !/^organization$/i.test(t))) c += 0.05;
  if (e.sameAs.length) c += 0.05;
  if (e.emails.length) c += 0.05;
  return Math.min(1, Math.round(c * 100) / 100);
}

// ---- entry point ----
export function buildEntity(payload: ScrapePayload): BusinessEntity {
  const e = emptyEntity();
  const meta = payload.metaTags;

  // 1) JSON-LD primary
  const candidates = flatten(payload.jsonLdSchemas).filter(looksLikeBusiness);
  let node: Node | null = null;
  if (candidates.length) {
    node = candidates.reduce((best, cur) => (scoreNode(cur) > scoreNode(best) ? cur : best));
    e.source = "json-ld";
  } else {
    // 2) microdata secondary
    node = microdataBusiness(payload.microdata);
    if (node) e.source = "microdata";
  }

  if (node) {
    e.name = str(node["name"]);
    e.legalName = str(node["legalName"]);
    e.types = typeList(node);
    e.description = str(node["description"]);
    e.telephones = dedupePhones(strArray(node["telephone"]));
    e.emails = cleanEmails(strArray(node["email"]));
    e.address = parseAddress(node["address"]);
    e.geo = parseGeo(node["geo"]);
    e.openingHours = parseHours(node["openingHoursSpecification"]);
    e.openingHoursText = strArray(node["openingHours"]);
    e.priceRange = str(node["priceRange"]);
    e.rating = parseRating(node["aggregateRating"]);
    e.sameAs = dedupeUrls(strArray(node["sameAs"]));
    e.logo = str(firstObj(node["logo"])?.["url"]) || str(node["logo"]);
    e.images = dedupeUrls(strArray(node["image"]));
    e.url = str(node["url"]);
    e.categories = [...new Set([...e.types, ...strArray(node["servesCuisine"])])].filter(
      (t) => !/^(organization|localbusiness)$/i.test(t),
    );
  }

  // 3) heuristic top-up from OpenGraph/meta + scraped contacts
  if (!e.name) e.name = meta["og:site_name"] || meta["og:title"] || payload.title;
  if (!e.description) e.description = payload.description || meta["og:description"] || "";
  if (!e.url) e.url = payload.canonical || meta["og:url"] || "";
  e.emails = cleanEmails([...e.emails, ...payload.contactInfo.emails]);
  e.telephones = dedupePhones([...e.telephones, ...payload.contactInfo.phones]);
  e.sameAs = dedupeUrls([...e.sameAs, ...payload.contactInfo.socialLinks]);
  if (e.images.length === 0 && meta["og:image"]) e.images = [meta["og:image"]];

  if (e.source === "none") {
    const hasAny = e.name || e.emails.length || e.telephones.length || e.sameAs.length;
    if (hasAny) e.source = "heuristic";
  }

  e.confidence = confidence(e);
  return e;
}

/** One-line postal address for display. */
export function formatAddress(a: PostalAddress | null): string {
  if (!a) return "";
  return [a.streetAddress, a.locality, a.region, a.postalCode, a.country].filter(Boolean).join(", ");
}
