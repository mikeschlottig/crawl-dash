// src/background/fetcher.ts
// "fetch" engine: a real cross-origin fetch from the service worker. Lightweight regex
// extraction over static HTML. Used as the fallback engine and where the debugger cannot
// attach. Non-HTML responses are recorded without extraction (content-type aware).
import type { CrawlRecord, JobConfig, QueueItem, ScrapePayload } from "../types";
import { emptyPayload } from "../types";
import { PermanentError, TransientError } from "./retry";
import { makeRecord } from "./records";
import { isHtmlType } from "./normalize";

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function decode(html: string, re: RegExp): string {
  const m = re.exec(html);
  return m ? m[1].trim().replace(/\s+/g, " ") : "";
}

function all(html: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1].trim().replace(/\s+/g, " "));
  return out;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

function metaContent(html: string, key: "name" | "property", val: string): string {
  const re = new RegExp(`<meta[^>]+${key}=["']${val}["'][^>]+content=["']([^"']*)["']`, "i");
  const m = re.exec(html);
  if (m) return m[1].trim();
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${key}=["']${val}["']`, "i");
  const m2 = re2.exec(html);
  return m2 ? m2[1].trim() : "";
}

function extract(html: string, origin: string): ScrapePayload {
  const p = emptyPayload("fetch");
  p.title = decode(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  p.description = metaContent(html, "name", "description");
  p.canonical = (/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html) ?? [])[1] ?? "";
  p.lang = (/<html[^>]+lang=["']([^"']+)["']/i.exec(html) ?? [])[1] ?? "";
  p.robots = metaContent(html, "name", "robots");

  // OpenGraph + common meta
  for (const prop of ["og:title", "og:description", "og:image", "og:url", "og:site_name"]) {
    const v = metaContent(html, "property", prop);
    if (v) p.metaTags[prop] = v;
  }
  if (p.description) p.metaTags["description"] = p.description;

  p.contactInfo.emails = Array.from(
    new Set((html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? []).map((e) => e.toLowerCase())),
  ).slice(0, 50);
  p.emails = p.contactInfo.emails;
  p.contactInfo.phones = Array.from(new Set(all(html, /href=["']tel:([^"']+)["']/gi))).slice(0, 25);
  p.contactInfo.socialLinks = Array.from(
    new Set(
      (html.match(/https?:\/\/(?:www\.)?(?:facebook|instagram|linkedin|twitter|x)\.com\/[^\s"'<>]+/gi) ?? []).map((s) =>
        s.replace(/["'<>]+$/, ""),
      ),
    ),
  ).slice(0, 25);
  p.headings.h1 = all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(stripTags).filter(Boolean).slice(0, 20);
  p.headings.h2 = all(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).map(stripTags).filter(Boolean).slice(0, 40);
  p.headings.h3 = all(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi).map(stripTags).filter(Boolean).slice(0, 60);

  // JSON-LD blocks (parsed; malformed individually skipped)
  for (const block of all(html, /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      p.jsonLdSchemas.push(JSON.parse(block));
    } catch {
      /* skip malformed block */
    }
  }

  const bodyText = stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, ""));
  p.wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  p.potentialSitemaps = [origin + "/sitemap.xml", origin + "/sitemap_index.xml"];
  return p;
}

export async function fetchEngine(item: QueueItem, config: JobConfig): Promise<CrawlRecord> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const started = Date.now();
  const origin = (() => {
    try {
      return new URL(item.url).origin;
    } catch {
      return "";
    }
  })();

  try {
    const res = await fetch(item.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "DirectoryCrawlerPro/2.0 (+leverageai)" },
    });
    const status = res.status;
    const contentType = res.headers.get("content-type");

    if (status >= 400) {
      const body = isHtmlType(contentType) ? await res.text().catch(() => "") : "";
      const payload = body ? extract(body, origin) : null;
      const rec = makeRecord({
        item,
        status: "http_error",
        httpStatus: status,
        loadMs: Date.now() - started,
        payload,
        screenshotRef: null,
        contentType,
        keywordAlerts: config.keywordAlerts,
      });
      if (TRANSIENT_STATUS.has(status)) throw new TransientError("HTTP " + status, rec);
      throw new PermanentError("HTTP " + status, rec);
    }

    // Non-HTML (PDF, image, JSON, etc.): record metadata without extraction.
    if (!isHtmlType(contentType)) {
      return makeRecord({
        item,
        status: "ok",
        httpStatus: status,
        loadMs: Date.now() - started,
        payload: null,
        screenshotRef: null,
        contentType,
        keywordAlerts: config.keywordAlerts,
      });
    }

    const html = await res.text();
    return makeRecord({
      item,
      status: "ok",
      httpStatus: status,
      loadMs: Date.now() - started,
      payload: extract(html, origin),
      screenshotRef: null,
      contentType,
      keywordAlerts: config.keywordAlerts,
    });
  } catch (err) {
    if (err instanceof PermanentError || err instanceof TransientError) throw err;
    if (controller.signal.aborted) throw new TransientError("timeout " + config.timeoutMs + "ms");
    throw new TransientError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}
