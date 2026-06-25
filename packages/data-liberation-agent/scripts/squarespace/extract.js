#!/usr/bin/env node
/**
 * extract.js — Step 2: Extract all content from a Squarespace site.
 *
 * Default mode uses the public ?format=json API. Admin mode connects to a
 * logged-in browser via CDP, captures editor API responses and hydration state,
 * and falls back to public extraction when admin data is incomplete.
 */

import { writeFileSync, mkdirSync, readFileSync, createWriteStream } from "fs";
import { basename, extname } from "path";
import { chromium } from "playwright";
import https from "https";
import http from "http";
import { pathToFileURL } from "url";

const args = process.argv.slice(2);
const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
const siteUrl = args.find((arg) => arg.startsWith("http")) || "https://example.com";
if (isMainModule && !args.find((arg) => arg.startsWith("http"))) {
  console.error(
    "Usage: node scripts/squarespace/extract.js <squarespace-url> [--inventory output/inventory.json] [--cdp-port <port>] [--cdp-admin]",
  );
  process.exit(1);
}

function getArg(name, fallback = null) {
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : fallback;
}

const delay = parseInt(getArg("--delay", "500"), 10);
const limitArg = getArg("--limit", null);
const limit = limitArg ? parseInt(limitArg, 10) : Infinity;
const inventoryFile = getArg("--inventory", null);
const cdpPort = getArg("--cdp-port") ? parseInt(getArg("--cdp-port"), 10) : null;
const cdpAdmin = args.includes("--cdp-admin");
if (isMainModule && cdpAdmin && !cdpPort) {
  console.error("--cdp-admin requires --cdp-port <port>");
  process.exit(1);
}

const origin = new URL(siteUrl).origin;
const targetHost = new URL(siteUrl).host;
mkdirSync("output/pages", { recursive: true });
mkdirSync("output/media", { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(url) {
  return new URL(url).pathname.replace(/^\//, "").replace(/\//g, "--") || "homepage";
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function makeHeaders(cookieStr) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  if (cookieStr) headers.Cookie = cookieStr;
  return headers;
}

async function getCookiesFromCDP(port, domain) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    return "";
  }
  const cookies = await context.cookies(domain);
  await browser.close();
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function connectToCdpPage(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] || (await browser.newContext());
  const existingPage = context.pages().find((candidate) => candidate.url().startsWith(`${origin}/config`));
  const page = existingPage || (await context.newPage());
  return { browser, context, page };
}

async function createPublicPage() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}

async function openAdminPage(page, entry) {
  const candidates = entry.adminPageId
    ? [`${origin}/config/pages/${entry.adminPageId}`, `${origin}/config/`]
    : [`${origin}/config/`];

  for (const candidate of candidates) {
    await page.goto(candidate, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await sleep(2500);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await sleep(750);

    const noPermissions = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      return /No Permissions/i.test(text) || /do not have permission/i.test(text);
    }).catch(() => false);

    if (!noPermissions) return candidate;
  }

  throw new Error(`Could not open site admin page for ${entry.url}`);
}

async function fetchJSON(url, cookieStr) {
  const separator = url.includes("?") ? "&" : "?";
  const jsonUrl = `${url}${separator}format=json`;
  try {
    const res = await fetch(jsonUrl, {
      headers: makeHeaders(cookieStr),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    console.error(`  Failed to fetch ${jsonUrl}: ${e.message}`);
    return null;
  }
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    proto
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        }
        const file = createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function isLikelyUrlText(value) {
  return /^https?:\/\//i.test(value) || /^\/api\//i.test(value);
}

function isLikelyOpaqueId(value) {
  return /^[a-f0-9]{20,}$/i.test(value);
}

function isLikelyHtml(value) {
  return /<[^>]+>/.test(value);
}

function normalizeMediaUrl(url) {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;

  try {
    const parsed = new URL(trimmed, origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (["bat.bing.com"].includes(parsed.hostname)) return null;
    return parsed.toString().split("?")[0];
  } catch {
    return null;
  }
}

const PUBLIC_CHROME_TEXT = new Set([
  "SKIP TO CONTENT",
  "Test Images",
  "About",
  "Contact",
  "Your Site Title",
  "Location",
]);

function looksLikeAdminChromeRecord(record) {
  const text = [record.title, record.description, record.content]
    .filter(Boolean)
    .join("\n");
  return [
    /\/api\//i,
    /Main Navigation/i,
    /Not Linked/i,
    /Publish update to access/i,
    /Version 7\.1/i,
  ].some((pattern) => pattern.test(text));
}

function shouldUsePublicDomFallback(record, entry) {
  if (!record) return true;
  if (!record.content && !record.sections?.length) return true;
  if (entry.type === "products" || entry.type === "product") return false;
  if (record.extractionMethod === "cdp-admin-accessibility") return true;
  if ((record.content || "").length < 80) return true;
  if ((record.sections || []).length <= 1) return true;
  return looksLikeAdminChromeRecord(record);
}

const IGNORED_ADMIN_API_PATTERNS = [
  "/api/context/",
  "/api/billing/",
  "/api/v1/in-product-notification-service/",
  "/api/v1/config-ui-preferences-service/",
  "/api/v1/commerce-preferences/",
  "/api/template/",
  "/api/multilingual/status",
  "/api/commerce/settings/payment/feature-gate-list",
  "/api/popup-overlay/",
];

const CONTENT_HINT_KEYS = new Set([
  "id",
  "pageId",
  "collectionId",
  "itemId",
  "folderId",
  "recordId",
  "fullUrl",
  "url",
  "pathname",
  "sourceUrl",
  "canonicalUrl",
  "permalink",
]);

const CONTENT_FIELDS = new Set([
  "body",
  "mainContent",
  "html",
  "contentHtml",
  "richText",
  "richContent",
  "text",
  "plainText",
  "description",
  "excerpt",
  "summary",
  "caption",
  "title",
  "heading",
  "navigationTitle",
  "assetUrl",
  "imageUrl",
  "originalSizeImageUrl",
  "src",
  "altText",
  "alt",
  "variants",
  "sku",
  "priceMoney",
  "salePriceMoney",
  "price",
  "inventory",
  "stock",
  "productType",
]);

function buildEntryNeedles(entry) {
  const pathname = new URL(entry.url).pathname;
  const needles = [entry.adminPageId, entry.url];
  if (pathname && pathname !== "/") {
    needles.push(pathname, encodeURIComponent(pathname));
  }
  return needles.filter(Boolean);
}

function stringMatchesEntry(value, needles) {
  if (typeof value !== "string") return false;
  return needles.some((needle) => value.includes(needle));
}

function payloadMentionsEntry(value, needles, visited = new WeakSet(), depth = 0) {
  if (depth > 8 || value == null) return false;
  if (typeof value === "string") return stringMatchesEntry(value, needles);
  if (typeof value !== "object") return false;
  if (visited.has(value)) return false;
  visited.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => payloadMentionsEntry(item, needles, visited, depth + 1));
  }

  return Object.entries(value).some(([key, child]) => {
    if (CONTENT_HINT_KEYS.has(key) && typeof child === "string") {
      return stringMatchesEntry(child, needles);
    }
    return payloadMentionsEntry(child, needles, visited, depth + 1);
  });
}

function filterRelevantPayload(value, entry, visited = new WeakSet(), depth = 0) {
  if (depth > 8 || value == null) return null;
  const needles = buildEntryNeedles(entry);

  if (typeof value === "string") {
    return stringMatchesEntry(value, needles) ? value : null;
  }

  if (typeof value !== "object") return value;
  if (visited.has(value)) return null;
  visited.add(value);

  if (Array.isArray(value)) {
    const items = value
      .map((item) => filterRelevantPayload(item, entry, visited, depth + 1))
      .filter((item) => item != null);
    return items.length ? items : null;
  }

  const objectMentionsEntry = payloadMentionsEntry(value, needles);
  const filtered = {};

  for (const [key, child] of Object.entries(value)) {
    if (CONTENT_HINT_KEYS.has(key)) {
      if (typeof child === "string" && stringMatchesEntry(child, needles)) {
        filtered[key] = child;
      }
      continue;
    }

    if (CONTENT_FIELDS.has(key)) {
      if (objectMentionsEntry || payloadMentionsEntry(child, needles)) {
        filtered[key] = child;
      }
      continue;
    }

    const nextValue = filterRelevantPayload(child, entry, visited, depth + 1);
    if (nextValue != null) filtered[key] = nextValue;
  }

  return Object.keys(filtered).length ? filtered : null;
}

function extractImageUrls(data) {
  const urls = new Set();
  const str = JSON.stringify(data);
  const matches =
    str.match(
      /https:\/\/(?:static1?\.squarespace\.com|images\.squarespace-cdn\.com)[^"'\s)}\]]+/g,
    ) || [];

  for (const url of matches) {
    const clean = normalizeMediaUrl(url);
    if (!clean) continue;
    if (clean.match(/\.(jpg|jpeg|png|gif|webp|svg|avif|ico)$/i)) {
      urls.add(clean);
    }
  }

  return [...urls];
}

function normalizeType(typeName, url) {
  const pathname = new URL(url).pathname.toLowerCase();
  const normalized = String(typeName || "").toLowerCase();
  if (normalized.startsWith("blog")) return "blog-post";
  if (normalized.startsWith("gallery") || normalized.startsWith("portfolio")) return "gallery";
  if (normalized.startsWith("product")) return "product";
  if (normalized.startsWith("event")) return "event";
  if (normalized.startsWith("index") || normalized.startsWith("folder")) return "index";
  if (normalized) return normalized;
  if (pathname.includes("/blog") || pathname.includes("/post")) return "blog-post";
  if (pathname.includes("/store") || pathname.includes("/product")) return "product";
  if (pathname.includes("/event")) return "event";
  return pathname === "/" ? "homepage" : "page";
}

function extractContentFromItem(item) {
  if (item.body) return item.body;
  if (item.excerpt) return item.excerpt;
  return "";
}

function extractContentFromCollection(collection) {
  if (collection.mainContent) return collection.mainContent;
  return "";
}

function extractPublicRecord(data, entry) {
  const collection = data.collection || {};
  const item = data.item || null;
  const isItem = !!item;
  const source = isItem ? item : collection;
  const type = entry?.type || normalizeType(collection.typeName, entry.url);
  const content = isItem ? extractContentFromItem(item) : extractContentFromCollection(collection);
  const title = source.title || source.navigationTitle || entry.title || new URL(entry.url).pathname;
  const description = source.seoDescription || source.metaDescription || item?.excerpt || "";
  const publishDate = source.publishOn
    ? new Date(source.publishOn).toISOString()
    : source.addedOn
      ? new Date(source.addedOn).toISOString()
      : null;
  const modifiedDate = source.updatedOn ? new Date(source.updatedOn).toISOString() : null;
  const featuredImage =
    source.assetUrl ||
    source.socialMediaImageUrl ||
    item?.systemDataVariants?.replace(/~.*/, "") ||
    null;
  const media = unique([...extractImageUrls(data), featuredImage]);

  return {
    sourceUrl: entry.url,
    slug: slugify(entry.url),
    extractedAt: new Date().toISOString(),
    platform: "squarespace",
    type,
    title,
    content,
    sections: content ? [{ type: "html", content }] : [],
    description,
    publishDate,
    modifiedDate,
    featuredImage,
    tags: source.tags || [],
    categories: source.categories || [],
    seo: {
      title: source.seoTitle || title,
      description,
    },
    media,
    collectionId: collection.id || null,
    collectionTitle: collection.title || null,
    passwordProtected: !!collection.passwordProtected,
    extractionMethod: "public-json",
    adminPageId: entry.adminPageId || null,
    raw: data,
  };
}

function loadInventoryEntries(filePath) {
  const inventory = JSON.parse(readFileSync(filePath, "utf8"));
  const seen = new Map();
  const canonicalAdminIds = new Set((inventory.urls || []).map((entry) => entry.adminPageId).filter(Boolean));

  function mergeEntry(entry) {
    if (!entry?.url) return;
    const existing = seen.get(entry.url) || {};
    seen.set(entry.url, {
      ...existing,
      ...entry,
      type: entry.type || existing.type || null,
      title: entry.title || existing.title || null,
      adminPageId: entry.adminPageId || existing.adminPageId || null,
    });
  }

  for (const collection of inventory.collections || []) {
    if (collection.collectionId && canonicalAdminIds.has(collection.collectionId)) continue;
    mergeEntry(collection);
    for (const item of collection.items || []) mergeEntry(item);
  }

  for (const entry of inventory.urls || []) mergeEntry(entry);
  return [...seen.values()];
}

function addSection(section, sections, seen) {
  if (!section) return;
  const normalized = { ...section };
  if (normalized.content) {
    normalized.content = String(normalized.content).replace(/\s+/g, " ").trim();
  }
  if (normalized.src) normalized.src = normalizeMediaUrl(String(normalized.src).trim());
  if (normalized.type === "text") {
    if (!normalized.content || isLikelyUrlText(normalized.content) || isLikelyOpaqueId(normalized.content)) {
      return;
    }
    if (PUBLIC_CHROME_TEXT.has(normalized.content)) return;
    if (isLikelyHtml(normalized.content)) {
      normalized.type = "html";
    }
  }
  if (normalized.type === "heading" && PUBLIC_CHROME_TEXT.has(normalized.content)) return;
  if (normalized.type === "heading" && normalized.content && normalized.content.length > 200) return;
  if (normalized.type === "heading" && normalized.content) {
    const previous = sections[sections.length - 1];
    if (previous?.type === "heading" && previous.content) {
      const currentCompact = normalized.content.toLowerCase().replace(/\s+/g, "");
      const previousCompact = previous.content.toLowerCase().replace(/\s+/g, "");
      if (previousCompact.length >= 12 && currentCompact.includes(previousCompact.repeat(2))) return;
    }
  }
  if (!normalized.content && !normalized.src) return;

  const key = JSON.stringify([
    normalized.type,
    normalized.content?.slice(0, 300) || null,
    normalized.src || null,
    normalized.alt || null,
  ]);
  if (seen.has(key)) return;
  seen.add(key);
  sections.push(normalized);
}

function addSectionsFromText(text, sections, seen) {
  if (!text || typeof text !== "string") return;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 20) return;
  addSection({ type: isLikelyHtml(trimmed) ? "html" : "text", content: trimmed }, sections, seen);
}

export function addSectionsFromValue(
  value,
  sections,
  seen,
  visited = new WeakSet(),
  depth = 0,
) {
  if (depth > 8 || value == null) return;

  if (typeof value === "string") {
    addSectionsFromText(value, sections, seen);
    return;
  }

  if (typeof value !== "object") return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) addSectionsFromValue(item, sections, seen, visited, depth + 1);
    return;
  }

  const htmlFields = ["body", "mainContent", "html", "contentHtml", "richText", "richContent"];
  for (const field of htmlFields) {
    if (typeof value[field] === "string" && value[field].trim()) {
      addSection({ type: "html", content: value[field].trim() }, sections, seen);
    }
  }

  const textFields = ["text", "plainText", "description", "excerpt", "summary", "caption"];
  for (const field of textFields) {
    if (typeof value[field] === "string") addSectionsFromText(value[field], sections, seen);
  }

  const heading = value.title || value.heading || value.navigationTitle || null;
  if (typeof heading === "string" && heading.trim() && heading.trim().length <= 200) {
    addSection({ type: "heading", content: heading.trim() }, sections, seen);
  }

  const imageSrc = value.assetUrl || value.imageUrl || value.originalSizeImageUrl || value.src || null;
  const normalizedImageSrc = normalizeMediaUrl(imageSrc);
  if (normalizedImageSrc) {
    addSection(
      {
        type: "image",
        src: normalizedImageSrc,
        alt: value.altText || value.alt || value.title || value.caption || "",
      },
      sections,
      seen,
    );
  }

  for (const child of Object.values(value)) {
    addSectionsFromValue(child, sections, seen, visited, depth + 1);
  }
}

export function domSectionsToHtml(sections) {
  return sections
    .map((section) => {
      if (section.type === "html") return section.content;
      if (section.type === "heading") return `<h2>${escapeHtml(section.content)}</h2>`;
      if (section.type === "image") {
        const alt = section.alt ? ` alt="${escapeHtml(section.alt)}"` : " alt=\"\"";
        const caption = section.alt ? `<figcaption>${escapeHtml(section.alt)}</figcaption>` : "";
        return `<figure><img src="${escapeHtml(section.src)}"${alt} />${caption}</figure>`;
      }
      return `<p>${escapeHtml(section.content)}</p>`;
    })
    .join("\n");
}

async function getAccessibilitySections(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const ax = await session.send("Accessibility.getFullAXTree", { depth: 10 });
    return (ax.nodes || [])
      .filter((node) => ["heading", "paragraph", "StaticText", "img"].includes(node.role?.value))
      .map((node) => {
        const role = node.role?.value;
        if (role === "img") {
          return {
            type: "image",
            src: null,
            alt: node.description?.value || node.name?.value || "",
          };
        }
        return {
          type: role === "heading" ? "heading" : "text",
          content: node.name?.value || "",
        };
      })
      .filter((section) => section.content || section.alt);
  } catch {
    return [];
  } finally {
    await session.detach().catch(() => {});
  }
}

async function getDomSections(page) {
  return page
    .evaluate(() => {
      const container = document.querySelector("main") || document.querySelector('[role="main"]') || document.body;
      const elements = [...container.querySelectorAll("h1, h2, h3, p, li, img")];
      return elements
        .map((element) => {
          if (element.tagName === "IMG") {
            const src = element.getAttribute("src");
            return src
              ? {
                  type: "image",
                  src,
                  alt: element.getAttribute("alt") || "",
                }
              : null;
          }

          const content = element.textContent?.trim();
          if (!content) return null;
          return {
            type: ["H1", "H2", "H3"].includes(element.tagName) ? "heading" : "text",
            content,
          };
        })
        .filter(Boolean)
        .slice(0, 250);
    })
    .catch(() => []);
}

async function extractPublicDomRecord(page, entry) {
  await page.goto(entry.url, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await sleep(2000);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await sleep(500);

  const landedUrl = page.url();
  if (landedUrl.includes("/config") || landedUrl.includes("squarespace.com/dashboard")) {
    throw new Error(`Public DOM navigation landed on admin surface: ${landedUrl}`);
  }

  const title = await page.title().catch(() => entry.title || slugify(entry.url));
  const domSections = await getDomSections(page);
  const accessibilitySections = await getAccessibilitySections(page);
  const sections = [];
  const seen = new Set();
  const fallbackSections = domSections.length ? domSections : accessibilitySections;
  for (const section of fallbackSections) {
    addSection(section, sections, seen);
  }

  const content = domSectionsToHtml(sections);
  const media = unique(
    sections
      .filter((section) => section.type === "image" && section.src)
      .map((section) => section.src),
  );
  const description = sections.find((section) => section.type === "text")?.content || "";

  return {
    sourceUrl: entry.url,
    slug: slugify(entry.url),
    extractedAt: new Date().toISOString(),
    platform: "squarespace",
    type: entry.type || normalizeType(null, entry.url),
    title: entry.title || title,
    content,
    sections,
    description,
    publishDate: null,
    modifiedDate: null,
    featuredImage: media[0] || null,
    tags: [],
    categories: [],
    seo: {
      title: entry.title || title,
      description,
    },
    media,
    extractionMethod: "public-dom",
    adminPageId: entry.adminPageId || null,
    raw: {
      domSections,
      accessibility: accessibilitySections,
    },
  };
}

function isAdminApiUrl(url, entry) {
  if (
    !(
      url.startsWith("https://www.squarespace.com/api/") ||
      url.startsWith(`https://${targetHost}/api/`) ||
      url.includes("/api/content/") ||
      url.includes("/api/commondata/")
    )
  ) {
    return false;
  }

  if (IGNORED_ADMIN_API_PATTERNS.some((pattern) => url.includes(pattern))) {
    return false;
  }

  const pathname = new URL(entry.url).pathname;
  return [entry.adminPageId, entry.url, pathname === "/" ? null : pathname, encodeURIComponent(pathname)]
    .filter(Boolean)
    .some((needle) => url.includes(needle));
}

function extractProductData(source) {
  const visited = new WeakSet();
  function visit(value) {
    if (!value || typeof value !== "object") return null;
    if (visited.has(value)) return null;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const result = visit(item);
        if (result) return result;
      }
      return null;
    }

    const hasProductMarkers =
      value.variants || value.sku || value.priceMoney || value.salePriceMoney || value.productType;
    if (hasProductMarkers) {
      return {
        id: value.id || value.productId || null,
        sku: value.sku || null,
        price: value.priceMoney || value.salePriceMoney || value.price || null,
        variants: value.variants || [],
        inventory: value.inventory || value.stock || null,
      };
    }

    for (const child of Object.values(value)) {
      const result = visit(child);
      if (result) return result;
    }
    return null;
  }

  return visit(source);
}

export function mergeRecords(primary, fallback) {
  if (!fallback) return primary;
  if (!primary) return fallback;

  return {
    ...fallback,
    ...primary,
    title: primary.title || fallback.title,
    type: primary.type || fallback.type,
    content: primary.content || fallback.content,
    sections: primary.sections?.length ? primary.sections : fallback.sections,
    description: primary.description || fallback.description,
    publishDate: primary.publishDate || fallback.publishDate,
    modifiedDate: primary.modifiedDate || fallback.modifiedDate,
    featuredImage: primary.featuredImage || fallback.featuredImage,
    tags: primary.tags?.length ? primary.tags : fallback.tags,
    categories: primary.categories?.length ? primary.categories : fallback.categories,
    media: unique([...(fallback.media || []), ...(primary.media || [])]),
    adminPageId: primary.adminPageId || fallback.adminPageId || null,
    raw: {
      public: fallback.raw || null,
      admin: primary.raw || null,
    },
  };
}

export function buildAdminRecordFromCaptured(captured, entry) {
  const filteredApiCalls = (captured.apiCalls || [])
    .map((call) => ({ ...call, data: filterRelevantPayload(call.data, entry) }))
    .filter((call) => call.data);
  const filteredNextData = filterRelevantPayload(captured.nextData, entry);

  const apiSections = [];
  const apiSeen = new Set();
  addSectionsFromValue(filteredApiCalls, apiSections, apiSeen);

  const nextSections = [];
  const nextSeen = new Set();
  addSectionsFromValue(filteredNextData, nextSections, nextSeen);

  const fallbackSections = [];
  const fallbackSeen = new Set();
  for (const section of [...(captured.domSections || []), ...(captured.accessibilitySections || [])]) {
    addSection(section, fallbackSections, fallbackSeen);
  }

  let sections = apiSections;
  let extractionMethod = "cdp-admin-api";
  if (!sections.length) {
    sections = nextSections;
    extractionMethod = "cdp-admin-next-data";
  }
  if (!sections.length) {
    sections = fallbackSections;
    extractionMethod = "cdp-admin-accessibility";
  }

  const content = domSectionsToHtml(sections);
  const media = unique([
    ...extractImageUrls({ apiCalls: filteredApiCalls, nextData: filteredNextData }),
    ...sections.filter((section) => section.type === "image" && section.src).map((section) => section.src),
  ]);
  const title =
    entry.title || sections.find((section) => section.type === "heading")?.content || slugify(entry.url);
  const description = sections.find((section) => section.type === "text")?.content || "";

  return {
    sourceUrl: entry.url,
    slug: slugify(entry.url),
    extractedAt: new Date().toISOString(),
    platform: "squarespace",
    type: entry.type || normalizeType(null, entry.url),
    title,
    content,
    sections,
    description,
    publishDate: null,
    modifiedDate: null,
    featuredImage: media[0] || null,
    tags: [],
    categories: [],
    seo: {
      title,
      description,
    },
    media,
    extractionMethod,
    adminPageId: entry.adminPageId,
    visibility: entry.visibility || null,
    pageStatus: entry.pageStatus || null,
    product: extractProductData([filteredApiCalls, filteredNextData]),
    raw: {
      apiCalls: filteredApiCalls,
      nextData: filteredNextData,
      accessibility: captured.accessibilitySections,
      domSections: captured.domSections,
    },
  };
}

async function extractAdminRecord(page, entry) {
  const captured = { apiCalls: [], nextData: null, domSections: [], accessibilitySections: [] };

  const responseHandler = async (response) => {
    const responseUrl = response.url();
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("application/json") || !isAdminApiUrl(responseUrl, entry)) return;
    try {
      const data = await response.json();
      captured.apiCalls.push({ url: responseUrl, data });
    } catch {}
  };

  page.on("response", responseHandler);
  try {
    await openAdminPage(page, entry);

    captured.nextData = await page.evaluate(() => window.__NEXT_DATA__ || null).catch(() => null);
    captured.domSections = await getDomSections(page);
    captured.accessibilitySections = await getAccessibilitySections(page);
  } finally {
    page.off("response", responseHandler);
  }

  return buildAdminRecordFromCaptured(captured, entry);
}

async function main() {
  console.log(`Extracting: ${siteUrl}\n`);

  let cookieStr = "";
  if (cdpPort) {
    console.log(`Extracting cookies from browser on CDP port ${cdpPort}...`);
    try {
      cookieStr = await getCookiesFromCDP(cdpPort, origin);
      console.log(
        cookieStr
          ? `  Got ${cookieStr.split(";").length} cookies`
          : "  No cookies found for this domain",
      );
    } catch (e) {
      console.error(`  Could not connect to CDP: ${e.message}`);
      console.error("  Continuing without cookies");
    }
  }

  let entries;
  if (inventoryFile) {
    console.log(`Loading URLs from ${inventoryFile}...`);
    entries = loadInventoryEntries(inventoryFile);
  } else {
    console.log("No inventory file — run discover.js first for best results.");
    console.log("Falling back to homepage only.");
    entries = [{ url: origin, type: "homepage", title: "Homepage", adminPageId: null }];
  }

  entries = entries.slice(0, limit);
  console.log(`Processing ${entries.length} URLs...\n`);

  const log = { processed: [], failed: [], mediaDownloaded: [] };
  const allImageUrls = new Set();

  let adminPage = null;
  let adminBrowser = null;
  let publicBrowser = null;
  let publicPage = null;
  if (cdpAdmin) {
    const cdp = await connectToCdpPage(cdpPort);
    adminBrowser = cdp.browser;
    adminPage = cdp.page;
    const publicSession = await createPublicPage();
    publicBrowser = publicSession.browser;
    publicPage = publicSession.page;
  }

  try {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const slug = slugify(entry.url);
      process.stdout.write(`[${i + 1}/${entries.length}] ${slug}... `);

      try {
        let record = null;
        let publicDomRecord = null;
        let publicRecord = null;

        if (cdpAdmin && adminPage && entry.adminPageId) {
          try {
            record = await extractAdminRecord(adminPage, entry);
          } catch (e) {
            log.failed.push({ url: entry.url, error: `Admin extract: ${e.message}` });
          }
        }

        if (cdpAdmin && publicPage && shouldUsePublicDomFallback(record, entry)) {
          try {
            publicDomRecord = await extractPublicDomRecord(publicPage, entry);
            if (publicDomRecord?.content) {
              record = publicDomRecord;
            }
          } catch (e) {
            log.failed.push({ url: entry.url, error: `Public DOM extract: ${e.message}` });
          }
        }

        const needsPublicFallback = !record || (!record.content && !record.sections?.length);
        if (needsPublicFallback || (publicDomRecord && !publicDomRecord.content)) {
          const publicData = await fetchJSON(entry.url, cookieStr);
          if (publicData) publicRecord = extractPublicRecord(publicData, entry);
        }

        record = mergeRecords(record, publicRecord);
        if (!record) {
          console.log("skip (no data)");
          log.failed.push({ url: entry.url, error: "No JSON or admin data" });
          continue;
        }

        writeFileSync(`output/pages/${slug}.json`, JSON.stringify(record, null, 2));
        for (const imageUrl of record.media || []) allImageUrls.add(imageUrl);
        if (record.featuredImage) allImageUrls.add(record.featuredImage);

        log.processed.push({
          url: entry.url,
          slug,
          type: record.type,
          extractionMethod: record.extractionMethod,
        });
        console.log(
          `${record.type} (${record.content.length} chars, ${record.media.length} images, ${record.extractionMethod})`,
        );
      } catch (e) {
        console.error(`FAILED: ${e.message}`);
        log.failed.push({ url: entry.url, error: e.message });
      }

      if (i < entries.length - 1) await sleep(delay);
    }
  } finally {
    if (adminBrowser) await adminBrowser.close();
    if (publicBrowser) await publicBrowser.close();
  }

  console.log(`\nDownloading ${allImageUrls.size} media files...`);
  let downloaded = 0;
  for (const imageUrl of allImageUrls) {
    const pathname = new URL(imageUrl).pathname;
    const filename = basename(pathname) || `image-${Date.now()}${extname(pathname) || ".jpg"}`;
    const dest = `output/media/${filename}`;
    try {
      await downloadFile(imageUrl, dest);
      log.mediaDownloaded.push({ url: imageUrl, file: dest });
      downloaded++;
      process.stdout.write(".");
    } catch (e) {
      log.failed.push({ url: imageUrl, error: `Media download: ${e.message}` });
      process.stdout.write("x");
    }
  }

  writeFileSync("output/extraction-log.json", JSON.stringify(log, null, 2));
  console.log("\n\nDone.");
  console.log(`  Pages extracted: ${log.processed.length}`);
  console.log(`  Media downloaded: ${downloaded}`);
  console.log(`  Failures: ${log.failed.length}`);
  if (log.failed.length) console.log("  See output/extraction-log.json for details");
  console.log("\nRun import.js to publish to WordPress.com");
}

if (isMainModule) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
