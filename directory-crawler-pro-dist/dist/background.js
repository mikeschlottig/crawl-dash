// src/types/job.ts
var DEFAULT_CONFIG = {
  timeoutMs: 3e4,
  concurrency: 3,
  perHostDelayMs: 600,
  maxRetries: 3,
  allowedDomains: [],
  keywordAlerts: [],
  engine: "render",
  fullPageScreenshot: true
};
var EMPTY_PROGRESS = { total: 0, done: 0, failed: 0, inFlight: 0 };
function initialState(config = DEFAULT_CONFIG) {
  return { status: "idle", config, queue: [], inFlight: [], progress: { ...EMPTY_PROGRESS } };
}

// src/types/record.ts
function emptyPayload(engine) {
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
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function emptyEntity() {
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
    confidence: 0
  };
}

// src/types/messages.ts
function assertNever(x) {
  throw new Error("Unhandled variant: " + JSON.stringify(x));
}

// src/background/store.ts
var K_STATE = "job:state";
var K_CONFIG = "cfg:default";
var K_LOGS = "log:buffer";
var REC_PREFIX = "rec:";
var SHOT_PREFIX = "shot:";
var LOG_CAP = 200;
async function readState() {
  const got = await chrome.storage.session.get(K_STATE);
  const s = got[K_STATE];
  if (s) return s;
  const cfg = await readConfig();
  return initialState(cfg);
}
async function writeState(state) {
  await chrome.storage.session.set({ [K_STATE]: state });
}
var chain = Promise.resolve();
function updateState(mutator) {
  const run = chain.then(async () => {
    const s = await readState();
    const result = await mutator(s);
    await writeState(s);
    return result;
  });
  chain = run.then(
    () => void 0,
    () => void 0
  );
  return run;
}
async function readConfig() {
  const got = await chrome.storage.local.get(K_CONFIG);
  return got[K_CONFIG] ?? { ...DEFAULT_CONFIG };
}
async function writeConfig(config) {
  await chrome.storage.local.set({ [K_CONFIG]: config });
}
async function putRecord(rec) {
  await chrome.storage.local.set({ [REC_PREFIX + rec.id]: rec });
}
async function listRecords() {
  const all2 = await chrome.storage.local.get(null);
  return Object.keys(all2).filter((k) => k.startsWith(REC_PREFIX)).map((k) => all2[k]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function clearRecords() {
  const all2 = await chrome.storage.local.get(null);
  const keys = Object.keys(all2).filter((k) => k.startsWith(REC_PREFIX) || k.startsWith(SHOT_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  await chrome.storage.session.remove(K_LOGS);
}
async function putScreenshot(recordId, dataUrl) {
  const key = SHOT_PREFIX + recordId;
  await chrome.storage.local.set({ [key]: dataUrl });
  return key;
}
async function getScreenshot(ref) {
  const got = await chrome.storage.local.get(ref);
  return got[ref] ?? null;
}
async function appendLog(entry) {
  const got = await chrome.storage.session.get(K_LOGS);
  const buf = (got[K_LOGS] ?? []).concat(entry);
  await chrome.storage.session.set({ [K_LOGS]: buf.slice(-LOG_CAP) });
}
async function readLogs() {
  const got = await chrome.storage.session.get(K_LOGS);
  return got[K_LOGS] ?? [];
}

// src/background/reducers.ts
function reconcileOrphans(state) {
  if (state.inFlight.length === 0) return { resumed: 0, dropped: 0 };
  let resumed = 0;
  let dropped = 0;
  for (let i = state.inFlight.length - 1; i >= 0; i--) {
    const item = state.inFlight[i];
    if (item.attempts < state.config.maxRetries) {
      item.attempts += 1;
      state.queue.unshift(item);
      resumed += 1;
    } else {
      state.progress.done += 1;
      state.progress.failed += 1;
      dropped += 1;
    }
  }
  state.inFlight = [];
  state.progress.inFlight = 0;
  return { resumed, dropped };
}
function pullSlots(state) {
  if (state.status !== "running") return [];
  const slots = state.config.concurrency - state.inFlight.length;
  const started = [];
  for (let i = 0; i < slots && state.queue.length > 0; i++) {
    const item = state.queue.shift();
    state.inFlight.push(item);
    started.push(item);
  }
  state.progress.inFlight = state.inFlight.length;
  return started;
}
function applyFinalize(state, id, status) {
  const before = state.inFlight.length;
  state.inFlight = state.inFlight.filter((q) => q.id !== id);
  if (state.inFlight.length === before) return;
  state.progress.inFlight = state.inFlight.length;
  state.progress.done += 1;
  if (status !== "ok") state.progress.failed += 1;
}
function isDrained(state) {
  return state.queue.length === 0 && state.inFlight.length === 0;
}

// src/background/retry.ts
var PermanentError = class extends Error {
  constructor(message, record) {
    super(message);
    this.record = record;
    this.name = "PermanentError";
  }
  retryable = false;
};
var TransientError = class extends Error {
  constructor(message, record) {
    super(message);
    this.record = record;
    this.name = "TransientError";
  }
  retryable = true;
};
function computeDelay(attempt, baseMs, capMs, jitterRatio, rand = Math.random) {
  const exp = Math.min(baseMs * 2 ** (attempt - 1), capMs);
  return exp + rand() * exp * jitterRatio;
}
function isNonRetryable(err) {
  return err instanceof Error && err.retryable === false;
}
async function withRetry(fn, maxAttempts, opts = {}) {
  const baseMs = opts.baseMs ?? 1e3;
  const capMs = opts.capMs ?? 15e3;
  const jitterRatio = opts.jitterRatio ?? 0.3;
  const sleep2 = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isNonRetryable(err)) throw err;
      if (attempt === maxAttempts) break;
      await sleep2(computeDelay(attempt, baseMs, capMs, jitterRatio));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
function recordFromError(err) {
  if (err instanceof PermanentError || err instanceof TransientError) return err.record;
  return void 0;
}

// src/background/normalize.ts
var EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
var EMAIL_JUNK = [
  "sentry",
  "wixpress",
  "example.com",
  "example.org",
  "domain.com",
  "yourdomain",
  "your@",
  "name@",
  "email@",
  "@2x",
  "u003e",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg"
];
function cleanEmails(raw) {
  const out = /* @__PURE__ */ new Set();
  for (const e of raw) {
    const v = e.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) continue;
    if (EMAIL_JUNK.some((j) => v.includes(j))) continue;
    out.add(v);
  }
  return Array.from(out).slice(0, 25);
}
function normalizePhone(raw) {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/[^\d]/g, "");
  return digits.length >= 7 ? plus + digits : "";
}
function dedupePhones(raw) {
  const canonKey = (digits) => digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const byKey = /* @__PURE__ */ new Map();
  const order = [];
  for (const p of raw) {
    const norm = normalizePhone(p);
    if (!norm) continue;
    const digits = norm.replace(/^\+/, "");
    const key = canonKey(digits);
    const existing = byKey.get(key);
    if (existing === void 0) {
      byKey.set(key, norm);
      order.push(key);
    } else if (norm.startsWith("+") && !existing.startsWith("+")) {
      byKey.set(key, norm);
    }
  }
  return order.map((k) => byKey.get(k)).slice(0, 25);
}
function normalizeUrl(raw) {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.search = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}
function dedupeUrls(raw) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const r of raw) {
    if (!r) continue;
    const n = normalizeUrl(r);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(r.trim());
  }
  return out.slice(0, 25);
}
function dayName(raw) {
  return raw.replace(/^https?:\/\/schema\.org\//i, "").trim();
}
function toNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function isHtmlType(contentType) {
  if (!contentType) return true;
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

// src/background/entity.ts
var BUSINESS_RE = /(business|organization|store|shop|restaurant|cafe|bar|hotel|lodging|service|dentist|physician|hospital|plumber|electrician|contractor|hvac|roofing|lawyer|attorney|legalservice|realestate|agent|salon|spa|gym|company|corporation|professional|automotive|repair|clinic|pharmacy|bakery|brewery)/i;
var EXCLUDE_RE = /(website|webpage|breadcrumb|searchaction|listitem|imageobject|videoobject|article|collectionpage)/i;
function flatten(nodes) {
  const out = [];
  const visit = (n) => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (n && typeof n === "object") {
      const o = n;
      if (Array.isArray(o["@graph"])) o["@graph"].forEach(visit);
      out.push(o);
    }
  };
  nodes.forEach(visit);
  return out;
}
function typeList(o) {
  const t = o["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x) => typeof x === "string");
  return [];
}
function looksLikeBusiness(o) {
  const types = typeList(o);
  const typeStr = types.join(" ");
  if (types.length && EXCLUDE_RE.test(typeStr) && !o["address"]) return false;
  if (BUSINESS_RE.test(typeStr)) return true;
  return Boolean(o["address"] || o["telephone"] || o["geo"]);
}
function scoreNode(o) {
  let s = 0;
  if (str(o["name"])) s += 3;
  if (o["address"]) s += 3;
  if (o["telephone"]) s += 2;
  if (o["geo"]) s += 1;
  if (o["openingHoursSpecification"] || o["openingHours"]) s += 1;
  if (o["aggregateRating"]) s += 1;
  if (o["sameAs"]) s += 1;
  const types = typeList(o).join(" ");
  if (BUSINESS_RE.test(types) && !/^organization$/i.test(types)) s += 2;
  return s;
}
function str(v) {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}
function strArray(v) {
  if (typeof v === "string") return [v.trim()].filter(Boolean);
  if (Array.isArray(v)) return v.map((x) => typeof x === "string" ? x.trim() : str(x)).filter(Boolean);
  return [];
}
function firstObj(v) {
  if (Array.isArray(v)) return v.find((x) => x && typeof x === "object") ?? null;
  if (v && typeof v === "object") return v;
  return null;
}
function parseAddress(v) {
  const a = firstObj(v);
  if (a) {
    const country = typeof a["addressCountry"] === "object" ? str(a["addressCountry"]["name"]) : str(a["addressCountry"]);
    const addr = {
      streetAddress: str(a["streetAddress"]),
      locality: str(a["addressLocality"]),
      region: str(a["addressRegion"]),
      postalCode: str(a["postalCode"]),
      country
    };
    return addr.streetAddress || addr.locality || addr.postalCode ? addr : null;
  }
  return null;
}
function parseGeo(v) {
  const g = firstObj(v);
  if (!g) return null;
  const lat = toNumber(g["latitude"]);
  const lng = toNumber(g["longitude"]);
  return lat !== null && lng !== null ? { lat, lng } : null;
}
function parseHours(v) {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  const out = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw;
    const days = strArray(o["dayOfWeek"]).map(dayName);
    const opens = str(o["opens"]);
    const closes = str(o["closes"]);
    if (opens || closes || days.length) out.push({ days, opens, closes });
  }
  return out;
}
function parseRating(v) {
  const r = firstObj(v);
  if (!r) return null;
  const value = toNumber(r["ratingValue"]);
  const count = toNumber(r["reviewCount"]) ?? toNumber(r["ratingCount"]);
  return value !== null ? { value, count: count ?? 0 } : null;
}
function microdataBusiness(items) {
  const biz = items.find((i) => BUSINESS_RE.test(i.type) && !EXCLUDE_RE.test(i.type));
  if (!biz) return null;
  const get = (k) => biz.props[k]?.[0] ?? "";
  const node = {
    "@type": biz.type.split("/").pop() ?? "LocalBusiness",
    name: get("name"),
    telephone: get("telephone"),
    email: get("email"),
    priceRange: get("priceRange")
  };
  const street = get("streetAddress");
  if (street || get("addressLocality") || get("postalCode")) {
    node["address"] = {
      streetAddress: street,
      addressLocality: get("addressLocality"),
      addressRegion: get("addressRegion"),
      postalCode: get("postalCode"),
      addressCountry: get("addressCountry")
    };
  }
  return node;
}
function confidence(e) {
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
function buildEntity(payload) {
  const e = emptyEntity();
  const meta = payload.metaTags;
  const candidates = flatten(payload.jsonLdSchemas).filter(looksLikeBusiness);
  let node = null;
  if (candidates.length) {
    node = candidates.reduce((best, cur) => scoreNode(cur) > scoreNode(best) ? cur : best);
    e.source = "json-ld";
  } else {
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
    e.categories = [.../* @__PURE__ */ new Set([...e.types, ...strArray(node["servesCuisine"])])].filter(
      (t) => !/^(organization|localbusiness)$/i.test(t)
    );
  }
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

// src/background/keywords.ts
function scanKeywords(payload, terms) {
  if (!payload || terms.length === 0) return [];
  const hay = [
    payload.title,
    payload.description,
    ...payload.headings.h1,
    ...payload.headings.h2,
    ...payload.headings.h3
  ].join(" \n ").toLowerCase();
  return terms.map((t) => t.trim()).filter((t) => t.length > 0 && hay.includes(t.toLowerCase()));
}
function collectKeywordHits(payload, entity, terms) {
  if (terms.length === 0) return [];
  const hits = new Set(scanKeywords(payload, terms));
  if (entity) {
    const hay = [entity.name, entity.description, ...entity.categories, ...entity.types].join(" \n ").toLowerCase();
    for (const t of terms) {
      const term = t.trim();
      if (term && hay.includes(term.toLowerCase())) hits.add(term);
    }
  }
  return Array.from(hits);
}

// src/background/records.ts
function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
function makeRecord(args) {
  const entity = args.payload ? buildEntity(args.payload) : null;
  return {
    id: args.item.id,
    url: args.item.url,
    hostname: hostnameOf(args.item.url),
    status: args.status,
    attempts: args.item.attempts,
    payload: args.payload,
    entity,
    capture: {
      httpStatus: args.httpStatus,
      loadMs: args.loadMs,
      screenshotRef: args.screenshotRef,
      contentType: args.contentType
    },
    keywordHits: collectKeywordHits(args.payload, entity, args.keywordAlerts),
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function errorRecord(item, err) {
  const msg = err instanceof Error ? err.message : String(err);
  const status = /timeout/i.test(msg) ? "timeout" : "nav_error";
  return {
    id: item.id,
    url: item.url,
    hostname: hostnameOf(item.url),
    status,
    attempts: item.attempts,
    payload: null,
    entity: null,
    capture: { httpStatus: null, loadMs: 0, screenshotRef: null, contentType: null },
    keywordHits: [],
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/content/scraper.ts
function scraperPipeline() {
  const uniq = (xs) => Array.from(new Set(xs));
  const textOf = (els) => Array.from(els).map((e) => e.innerText.trim()).filter(Boolean);
  const metaTags = {};
  document.querySelectorAll("meta").forEach((m) => {
    const k = m.getAttribute("name") || m.getAttribute("property");
    const v = m.getAttribute("content");
    if (k && v) metaTags[k] = v;
  });
  const jsonLdSchemas = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      jsonLdSchemas.push(JSON.parse(s.innerText));
    } catch {
    }
  });
  const microdata = [];
  document.querySelectorAll("[itemscope][itemtype]").forEach((scope) => {
    const type = scope.getAttribute("itemtype") || "";
    const props = {};
    scope.querySelectorAll("[itemprop]").forEach((el) => {
      const name = el.getAttribute("itemprop");
      if (!name) return;
      const val = el.getAttribute("content") || el.href || el.content || el.innerText?.trim() || "";
      if (val) (props[name] ??= []).push(val.toString().trim());
    });
    if (Object.keys(props).length) microdata.push({ type, props });
  });
  const emails = uniq(
    Array.from(document.querySelectorAll('a[href^="mailto:"]')).map(
      (a) => a.href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase()
    )
  ).filter(Boolean);
  const phones = uniq(
    Array.from(document.querySelectorAll('a[href^="tel:"]')).map(
      (a) => a.href.replace(/^tel:/i, "").trim()
    )
  ).filter(Boolean);
  const socialLinks = uniq(
    Array.from(
      document.querySelectorAll(
        'a[href*="facebook.com"],a[href*="instagram.com"],a[href*="linkedin.com"],a[href*="twitter.com"],a[href*="x.com"]'
      )
    ).map((a) => a.href)
  );
  let internal = 0;
  let external = 0;
  const externalHosts = /* @__PURE__ */ new Set();
  const here = location.hostname;
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.href;
    try {
      const h = new URL(href).hostname;
      if (!h) return;
      if (h === here) internal++;
      else {
        external++;
        if (externalHosts.size < 15) externalHosts.add(h);
      }
    } catch {
    }
  });
  const canonical = document.querySelector('link[rel="canonical"]')?.href || "";
  const bodyText = (document.body?.innerText || "").trim();
  return {
    title: document.title,
    description: metaTags["description"] ?? "",
    contactInfo: { emails, phones, socialLinks },
    headings: {
      h1: textOf(document.querySelectorAll("h1")),
      h2: textOf(document.querySelectorAll("h2")),
      h3: textOf(document.querySelectorAll("h3"))
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
    engine: "render",
    capturedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}

// src/content/autoscroll.ts
async function autoScroll() {
  const STEP = 600;
  const INTERVAL = 90;
  const MAX_MS = 15e3;
  const STABLE_TICKS = 6;
  const start = Date.now();
  let lastHeight = 0;
  let stable = 0;
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      window.scrollBy(0, STEP);
      const h = document.documentElement.scrollHeight;
      stable = h === lastHeight ? stable + 1 : 0;
      lastHeight = h;
      const atBottom = window.innerHeight + window.scrollY >= h - 2;
      if (atBottom && stable >= STABLE_TICKS || Date.now() - start > MAX_MS) {
        clearInterval(timer);
        window.scrollTo(0, 0);
        resolve();
      }
    }, INTERVAL);
  });
}

// src/background/capture.ts
var TRANSIENT_STATUS = /* @__PURE__ */ new Set([408, 425, 429, 500, 502, 503, 504]);
var PROTOCOL_VERSION = "1.3";
var MAX_SHOT_HEIGHT = 18e3;
var SETTLE_MS = 400;
var windowId = null;
var creating = null;
async function ensureWindow() {
  if (windowId != null) {
    try {
      await chrome.windows.get(windowId);
      return windowId;
    } catch {
      windowId = null;
    }
  }
  if (!creating) {
    creating = chrome.windows.create({ url: "about:blank", focused: false, type: "normal", width: 1280, height: 1600, left: -2400, top: 0 }).then((w) => {
      windowId = w.id ?? null;
      if (windowId == null) throw new Error("window creation returned no id");
      return windowId;
    }).finally(() => {
      creating = null;
    });
  }
  return creating;
}
async function closeCrawlerWindow() {
  if (windowId != null) {
    const id = windowId;
    windowId = null;
    await chrome.windows.remove(id).catch(() => void 0);
  }
}
async function renderEngine(item, config) {
  const winId = await ensureWindow();
  const tab = await chrome.tabs.create({ windowId: winId, url: "about:blank", active: false });
  const tabId = tab.id;
  if (tabId == null) throw new TransientError("tab creation returned no id");
  const debuggee = { tabId };
  const started = Date.now();
  let httpStatus = null;
  let contentType = null;
  let settled = false;
  let resolveLoad;
  let rejectLoad;
  const loaded = new Promise((res, rej) => {
    resolveLoad = res;
    rejectLoad = rej;
  });
  const onEvent = (src, method, params) => {
    if (src.tabId !== tabId) return;
    if (method === "Network.responseReceived") {
      const p = params;
      if (p?.type === "Document" && httpStatus === null && typeof p.response?.status === "number") {
        httpStatus = p.response.status;
        contentType = p.response.mimeType ?? null;
      }
    } else if (method === "Page.loadEventFired") {
      resolveLoad();
    } else if (method === "Inspector.detached") {
      rejectLoad(new TransientError("debugger detached"));
    }
  };
  const cleanup = async () => {
    if (settled) return;
    settled = true;
    chrome.debugger.onEvent.removeListener(onEvent);
    await chrome.debugger.detach(debuggee).catch(() => void 0);
    await chrome.tabs.remove(tabId).catch(() => void 0);
  };
  const watchdog = new Promise(
    (_, reject) => setTimeout(() => reject(new TransientError(`timeout ${config.timeoutMs}ms`)), config.timeoutMs)
  );
  const work = (async () => {
    await chrome.debugger.attach(debuggee, PROTOCOL_VERSION);
    chrome.debugger.onEvent.addListener(onEvent);
    await send(debuggee, "Network.enable");
    await send(debuggee, "Page.enable");
    const nav = await send(debuggee, "Page.navigate", { url: item.url });
    if (nav?.errorText) throw new TransientError(`nav: ${nav.errorText}`);
    await loaded;
    if (httpStatus !== null && httpStatus >= 400) {
      const payload2 = await scrape(tabId).catch(() => null);
      const rec = makeRecord({
        item,
        status: "http_error",
        httpStatus,
        loadMs: Date.now() - started,
        payload: payload2,
        screenshotRef: null,
        contentType,
        keywordAlerts: config.keywordAlerts
      });
      if (TRANSIENT_STATUS.has(httpStatus)) throw new TransientError("HTTP " + httpStatus, rec);
      throw new PermanentError("HTTP " + httpStatus, rec);
    }
    await inject(tabId, autoScroll);
    await delay(SETTLE_MS);
    const payload = await scrape(tabId);
    let screenshotRef = null;
    if (config.fullPageScreenshot) {
      const dataUrl = await captureFullPage(debuggee).catch(() => null);
      if (dataUrl) screenshotRef = await putScreenshot(item.id, dataUrl);
    }
    return makeRecord({
      item,
      status: "ok",
      httpStatus: httpStatus ?? 200,
      loadMs: Date.now() - started,
      payload,
      screenshotRef,
      contentType,
      keywordAlerts: config.keywordAlerts
    });
  })();
  try {
    return await Promise.race([work, watchdog]);
  } finally {
    await cleanup();
  }
}
function send(d, method, params) {
  return chrome.debugger.sendCommand(d, method, params);
}
var delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function inject(tabId, func) {
  await chrome.scripting.executeScript({ target: { tabId }, func });
}
async function scrape(tabId) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: scraperPipeline });
  return res.result;
}
async function captureFullPage(d) {
  const metrics = await send(d, "Page.getLayoutMetrics");
  const size = metrics.cssContentSize ?? metrics.contentSize ?? { width: 1280, height: 1600 };
  const width = Math.max(1, Math.ceil(size.width));
  const height = Math.min(MAX_SHOT_HEIGHT, Math.max(1, Math.ceil(size.height)));
  const shot = await send(d, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 }
  });
  return "data:image/png;base64," + shot.data;
}

// src/background/fetcher.ts
var TRANSIENT_STATUS2 = /* @__PURE__ */ new Set([408, 425, 429, 500, 502, 503, 504]);
function decode(html, re) {
  const m = re.exec(html);
  return m ? m[1].trim().replace(/\s+/g, " ") : "";
}
function all(html, re) {
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].trim().replace(/\s+/g, " "));
  return out;
}
function stripTags(s) {
  return s.replace(/<[^>]*>/g, "").trim();
}
function metaContent(html, key, val) {
  const re = new RegExp(`<meta[^>]+${key}=["']${val}["'][^>]+content=["']([^"']*)["']`, "i");
  const m = re.exec(html);
  if (m) return m[1].trim();
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${key}=["']${val}["']`, "i");
  const m2 = re2.exec(html);
  return m2 ? m2[1].trim() : "";
}
function extract(html, origin) {
  const p = emptyPayload("fetch");
  p.title = decode(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  p.description = metaContent(html, "name", "description");
  p.canonical = (/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html) ?? [])[1] ?? "";
  p.lang = (/<html[^>]+lang=["']([^"']+)["']/i.exec(html) ?? [])[1] ?? "";
  p.robots = metaContent(html, "name", "robots");
  for (const prop of ["og:title", "og:description", "og:image", "og:url", "og:site_name"]) {
    const v = metaContent(html, "property", prop);
    if (v) p.metaTags[prop] = v;
  }
  if (p.description) p.metaTags["description"] = p.description;
  p.contactInfo.emails = Array.from(
    new Set((html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? []).map((e) => e.toLowerCase()))
  ).slice(0, 50);
  p.emails = p.contactInfo.emails;
  p.contactInfo.phones = Array.from(new Set(all(html, /href=["']tel:([^"']+)["']/gi))).slice(0, 25);
  p.contactInfo.socialLinks = Array.from(
    new Set(
      (html.match(/https?:\/\/(?:www\.)?(?:facebook|instagram|linkedin|twitter|x)\.com\/[^\s"'<>]+/gi) ?? []).map(
        (s) => s.replace(/["'<>]+$/, "")
      )
    )
  ).slice(0, 25);
  p.headings.h1 = all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(stripTags).filter(Boolean).slice(0, 20);
  p.headings.h2 = all(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).map(stripTags).filter(Boolean).slice(0, 40);
  p.headings.h3 = all(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi).map(stripTags).filter(Boolean).slice(0, 60);
  for (const block of all(html, /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      p.jsonLdSchemas.push(JSON.parse(block));
    } catch {
    }
  }
  const bodyText = stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, ""));
  p.wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  p.potentialSitemaps = [origin + "/sitemap.xml", origin + "/sitemap_index.xml"];
  return p;
}
async function fetchEngine(item, config) {
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
      headers: { "User-Agent": "DirectoryCrawlerPro/2.0 (+leverageai)" }
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
        keywordAlerts: config.keywordAlerts
      });
      if (TRANSIENT_STATUS2.has(status)) throw new TransientError("HTTP " + status, rec);
      throw new PermanentError("HTTP " + status, rec);
    }
    if (!isHtmlType(contentType)) {
      return makeRecord({
        item,
        status: "ok",
        httpStatus: status,
        loadMs: Date.now() - started,
        payload: null,
        screenshotRef: null,
        contentType,
        keywordAlerts: config.keywordAlerts
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
      keywordAlerts: config.keywordAlerts
    });
  } catch (err) {
    if (err instanceof PermanentError || err instanceof TransientError) throw err;
    if (controller.signal.aborted) throw new TransientError("timeout " + config.timeoutMs + "ms");
    throw new TransientError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

// src/background/engine.ts
async function runEngine(item, config) {
  if (config.engine === "fetch") return fetchEngine(item, config);
  try {
    return await renderEngine(item, config);
  } catch (err) {
    if (err instanceof PermanentError && err.record) throw err;
    if (isAttachFailure(err)) return fetchEngine(item, config);
    throw err;
  }
}
function isAttachFailure(err) {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("cannot access") || msg.includes("another debugger") || msg.includes("cannot attach") || msg.includes("devtools") || msg.includes("not attached");
}

// src/background/keepalive.ts
var OFFSCREEN_URL = "dist/offscreen.html";
async function ensureKeepAlive() {
  if (typeof chrome.offscreen?.hasDocument === "function") {
    if (await chrome.offscreen.hasDocument()) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "Keep the crawl orchestrator alive during long-running jobs."
    });
  } catch {
  }
}
async function releaseKeepAlive() {
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch {
  }
}

// src/background/filter.ts
function passesDomainFilter(url, allowed) {
  if (allowed.length === 0) return true;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((d) => {
    const dom = d.trim().toLowerCase().replace(/^\*\./, "").replace(/^\.+/, "");
    if (!dom) return false;
    return host === dom || host.endsWith("." + dom);
  });
}

// src/background/hash.ts
function hashUrl(url) {
  let h1 = 3735928559 ^ url.length;
  let h2 = 1103547991 ^ url.length;
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507);
  h1 ^= Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507);
  h2 ^= Math.imul(h1 ^ h1 >>> 13, 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36);
}

// src/background/bus.ts
function emit(event) {
  chrome.runtime.sendMessage(event).catch(() => void 0);
}
async function log(level, text) {
  const entry = { level, text, ts: Date.now() };
  await appendLog(entry);
  emit({ kind: "LOG", entry });
}
async function emitStatus() {
  const s = await readState();
  emit({ kind: "STATUS", status: s.status, progress: s.progress });
}

// src/background/orchestrator.ts
var pumping = false;
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function startCrawl(urls, config) {
  const items = urls.map((u) => u.trim()).filter(Boolean).filter((u) => passesDomainFilter(u, config.allowedDomains)).map((u) => ({ id: hashUrl(u), url: u, attempts: 0 }));
  const skipped = urls.filter((u) => u.trim()).length - items.length;
  await updateState((s) => {
    s.config = config;
    s.queue.push(...items);
    s.progress.total += items.length;
    s.status = "running";
  });
  await log("info", `Queued ${items.length} target(s)${skipped ? `, skipped ${skipped} (domain filter)` : ""}.`);
  await ensureKeepAlive();
  await emitStatus();
  void pump();
}
async function pause() {
  await updateState((s) => {
    s.status = "paused";
  });
  await log("warn", "Crawl paused. In-flight targets finish; queue is held.");
  await emitStatus();
}
async function resume() {
  await updateState((s) => {
    if (s.status === "paused") s.status = "running";
  });
  await ensureKeepAlive();
  await log("info", "Crawl resumed.");
  await emitStatus();
  void pump();
}
async function resumeIfNeeded() {
  const s = await readState();
  if (s.status !== "running" || pumping) return;
  const { resumed, dropped } = await updateState((st) => reconcileOrphans(st));
  if (resumed > 0 || dropped > 0) {
    await log(
      "success",
      `Worker restarted \u2014 recovered ${resumed} orphaned target(s)` + (dropped ? `, dropped ${dropped} over retry budget.` : ".")
    );
    await emitStatus();
  }
  await closeCrawlerWindow();
  await ensureKeepAlive();
  void pump();
}
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (; ; ) {
      const started = await updateState((s) => pullSlots(s));
      for (const item of started) void runItem(item);
      const state = await readState();
      if (state.status !== "running") break;
      if (isDrained(state)) {
        await updateState((s) => {
          s.status = "idle";
        });
        await releaseKeepAlive();
        await closeCrawlerWindow();
        await log("success", `Crawl complete \u2014 ${state.progress.done} processed, ${state.progress.failed} failed.`);
        await emitStatus();
        break;
      }
      await sleep(Math.max(120, state.config.perHostDelayMs));
    }
  } finally {
    pumping = false;
  }
}
async function runItem(item) {
  const config = (await readState()).config;
  let record;
  try {
    record = await withRetry(() => runEngine(item, config), config.maxRetries);
  } catch (err) {
    record = recordFromError(err) ?? errorRecord(item, err);
  }
  await finalize(item, record);
}
async function finalize(item, record) {
  await putRecord(record);
  await updateState((s) => applyFinalize(s, item.id, record.status));
  emit({ kind: "RECORD_DONE", record });
  if (record.keywordHits.length) {
    emit({ kind: "KEYWORD_HIT", recordId: record.id, hostname: record.hostname, terms: record.keywordHits });
  }
  const tag = record.status === "ok" ? "ok" : record.capture.httpStatus ? `HTTP ${record.capture.httpStatus}` : record.status;
  await log(record.status === "ok" ? "info" : "error", `${tag} \xB7 ${record.url}`);
  await emitStatus();
}

// src/background/index.ts
var RESUME_ALARM = "resume-watchdog";
chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(RESUME_ALARM, { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  void resumeIfNeeded();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RESUME_ALARM) void resumeIfNeeded();
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.kind === "__KEEPALIVE__") {
    void resumeIfNeeded();
    return false;
  }
  void (async () => {
    try {
      switch (msg.kind) {
        case "START_CRAWL":
          await writeConfig(msg.config);
          await startCrawl(msg.urls, msg.config);
          sendResponse({ ok: true });
          break;
        case "PAUSE_CRAWL":
          await pause();
          sendResponse({ ok: true });
          break;
        case "RESUME_CRAWL":
          await resume();
          sendResponse({ ok: true });
          break;
        case "CLEAR_HISTORY":
          await clearRecords();
          await releaseKeepAlive();
          await log("info", "History cleared.");
          await emitStatus();
          sendResponse({ ok: true });
          break;
        case "GET_SNAPSHOT": {
          sendResponse(await buildSnapshot());
          break;
        }
        case "GET_SCREENSHOT": {
          sendResponse({ dataUrl: await getScreenshot(msg.ref) });
          break;
        }
        default:
          assertNever(msg);
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true;
});
async function buildSnapshot() {
  const [state, records, logs, config] = await Promise.all([
    readState(),
    listRecords(),
    readLogs(),
    readConfig()
  ]);
  return { status: state.status, progress: state.progress, config, records, logs };
}
void resumeIfNeeded();
//# sourceMappingURL=background.js.map
