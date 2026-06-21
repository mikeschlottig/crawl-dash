// src/content/scraper.ts
// Injected into the page via chrome.scripting.executeScript. MUST be fully self-contained
// (no references to outer scope). Returns a ScrapePayload-shaped object built from the
// fully rendered DOM, including microdata, canonical/lang/robots, link stats, and a word
// count — the raw material the entity normalizer turns into a BusinessEntity.
export function scraperPipeline() {
  const uniq = (xs: string[]) => Array.from(new Set(xs));
  const textOf = (els: NodeListOf<Element>) =>
    Array.from(els)
      .map((e) => (e as HTMLElement).innerText.trim())
      .filter(Boolean);

  const metaTags: Record<string, string> = {};
  document.querySelectorAll("meta").forEach((m) => {
    const k = m.getAttribute("name") || m.getAttribute("property");
    const v = m.getAttribute("content");
    if (k && v) metaTags[k] = v;
  });

  const jsonLdSchemas: unknown[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      jsonLdSchemas.push(JSON.parse((s as HTMLElement).innerText));
    } catch {
      /* skip malformed node */
    }
  });

  // Microdata: one level of itemscope → itemprop extraction.
  const microdata: { type: string; props: Record<string, string[]> }[] = [];
  document.querySelectorAll("[itemscope][itemtype]").forEach((scope) => {
    const type = scope.getAttribute("itemtype") || "";
    const props: Record<string, string[]> = {};
    scope.querySelectorAll("[itemprop]").forEach((el) => {
      const name = el.getAttribute("itemprop");
      if (!name) return;
      const val =
        el.getAttribute("content") ||
        (el as HTMLAnchorElement).href ||
        (el as HTMLMetaElement).content ||
        (el as HTMLElement).innerText?.trim() ||
        "";
      if (val) (props[name] ??= []).push(val.toString().trim());
    });
    if (Object.keys(props).length) microdata.push({ type, props });
  });

  const emails = uniq(
    Array.from(document.querySelectorAll('a[href^="mailto:"]')).map((a) =>
      (a as HTMLAnchorElement).href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase(),
    ),
  ).filter(Boolean);

  const phones = uniq(
    Array.from(document.querySelectorAll('a[href^="tel:"]')).map((a) =>
      (a as HTMLAnchorElement).href.replace(/^tel:/i, "").trim(),
    ),
  ).filter(Boolean);

  const socialLinks = uniq(
    Array.from(
      document.querySelectorAll(
        'a[href*="facebook.com"],a[href*="instagram.com"],a[href*="linkedin.com"],a[href*="twitter.com"],a[href*="x.com"]',
      ),
    ).map((a) => (a as HTMLAnchorElement).href),
  );

  // Link stats: internal vs external.
  let internal = 0;
  let external = 0;
  const externalHosts = new Set<string>();
  const here = location.hostname;
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = (a as HTMLAnchorElement).href;
    try {
      const h = new URL(href).hostname;
      if (!h) return;
      if (h === here) internal++;
      else {
        external++;
        if (externalHosts.size < 15) externalHosts.add(h);
      }
    } catch {
      /* ignore non-URL hrefs */
    }
  });

  const canonical =
    (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href || "";
  const bodyText = (document.body?.innerText || "").trim();

  return {
    title: document.title,
    description: metaTags["description"] ?? "",
    contactInfo: { emails, phones, socialLinks },
    headings: {
      h1: textOf(document.querySelectorAll("h1")),
      h2: textOf(document.querySelectorAll("h2")),
      h3: textOf(document.querySelectorAll("h3")),
    },
    metaTags,
    jsonLdSchemas,
    microdata,
    potentialSitemaps: [location.origin + "/sitemap.xml", location.origin + "/sitemap_index.xml"],
    canonical,
    lang: document.documentElement.lang || "",
    robots: metaTags["robots"] ?? "",
    wordCount: bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0,
    links: { internal, external, sampleExternalHosts: Array.from(externalHosts) },
    emails,
    engine: "render" as const,
    capturedAt: new Date().toISOString(),
  };
}
