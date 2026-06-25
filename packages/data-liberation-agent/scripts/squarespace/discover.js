#!/usr/bin/env node
/**
 * discover.js — Step 1: Inventory a Squarespace site
 *
 * Default mode uses Squarespace's public ?format=json API. Admin mode connects
 * to a logged-in browser over CDP and merges richer page-tree data from the
 * Squarespace editor.
 *
 * Usage:
 *   node scripts/squarespace/discover.js https://www.example.com
 *   node scripts/squarespace/discover.js https://www.example.com --cdp-port 9222
 *   node scripts/squarespace/discover.js https://www.example.com --cdp-admin --cdp-port 9222
 *
 * Output:
 *   output/inventory.json — categorized list of all content URLs
 */

import { writeFileSync, mkdirSync } from "fs";
import { chromium } from "playwright";
import { pathToFileURL } from "url";

const args = process.argv.slice(2);
const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
const siteUrl = args.find((a) => a.startsWith("http")) || "https://example.com";
if (isMainModule && !args.find((a) => a.startsWith("http"))) {
  console.error(
    "Usage: node scripts/squarespace/discover.js <squarespace-url> [--cdp-port <port>] [--cdp-admin]",
  );
  process.exit(1);
}

function getArg(name, fallback = null) {
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : fallback;
}

const cdpPort = getArg("--cdp-port") ? parseInt(getArg("--cdp-port"), 10) : null;
const cdpAdmin = args.includes("--cdp-admin");
if (isMainModule && cdpAdmin && !cdpPort) {
  console.error("--cdp-admin requires --cdp-port <port>");
  process.exit(1);
}

const origin = new URL(siteUrl).origin;
const targetHost = new URL(siteUrl).host;
mkdirSync("output", { recursive: true });

const COLLECTION_TYPES = {
  1: "index",
  2: "gallery",
  5: "album",
  6: "blog",
  7: "events",
  8: "products",
  10: "page",
  11: "portfolio",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeHeaders(cookieStr) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  };
  if (cookieStr) headers.Cookie = cookieStr;
  return headers;
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

async function fetchSitemap(cookieStr) {
  const urls = [];
  try {
    const res = await fetch(`${origin}/sitemap.xml`, {
      headers: makeHeaders(cookieStr),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return urls;

    const text = await res.text();
    const locs = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    for (const loc of locs) {
      if (loc.endsWith(".xml")) {
        try {
          const childRes = await fetch(loc, {
            headers: makeHeaders(cookieStr),
            signal: AbortSignal.timeout(15000),
          });
          if (!childRes.ok) continue;

          const childText = await childRes.text();
          const childLocs = [...childText.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
            (m) => m[1].trim(),
          );
          urls.push(...childLocs.filter((childLoc) => !childLoc.endsWith(".xml")));
        } catch {}
      } else {
        urls.push(loc);
      }
    }
  } catch (e) {
    console.error(`  Sitemap fetch failed: ${e.message}`);
  }
  return urls;
}

function classify(type, urlPath, typeName) {
  if (typeName) {
    const normalized = String(typeName).toLowerCase();
    if (normalized.startsWith("blog")) return "blog";
    if (normalized.startsWith("gallery")) return "gallery";
    if (normalized.startsWith("portfolio")) return "portfolio";
    if (normalized.startsWith("events")) return "events";
    if (normalized.startsWith("products")) return "products";
    if (normalized.startsWith("index") || normalized.startsWith("folder")) return "index";
    return normalized;
  }
  if (COLLECTION_TYPES[type]) return COLLECTION_TYPES[type];

  const path = urlPath.toLowerCase();
  if (path.includes("/blog") || path.includes("/post")) return "blog";
  if (path.includes("/gallery") || path.includes("/portfolio")) return "gallery";
  if (path.includes("/store") || path.includes("/product")) return "products";
  if (path.includes("/event")) return "events";
  return path === "/" ? "homepage" : "page";
}

function classifyCollectionItem(parentType, item) {
  if (item?.recordType === 2) return "image";
  if (parentType === "blog") return "blog-post";
  if (parentType === "gallery" || parentType === "portfolio") return "image";
  if (parentType === "products") return "product";
  if (parentType === "events") return "event";
  return "item";
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

async function discoverPublic(cookieStr) {
  console.log("Fetching site data...");
  const homeData = await fetchJSON(origin, cookieStr);
  if (!homeData) {
    console.error("Could not fetch site data. Is this a Squarespace site?");
    process.exit(1);
  }

  const website = homeData.website || homeData.websiteData || {};
  const sqVersion = website.templateVersion || website.siteVersion || null;

  console.log(`  Site: ${website.siteTitle || "(untitled)"}`);
  console.log(`  Domain: ${website.primaryDomain || origin}`);
  console.log(`  Website ID: ${website.id || "(unknown)"}`);
  if (sqVersion) console.log(`  Squarespace version: ${sqVersion}`);

  console.log("\nFetching sitemap...");
  const sitemapUrls = await fetchSitemap(cookieStr);
  console.log(`  Found ${sitemapUrls.length} URLs in sitemap`);

  const allUrls = [...new Set(sitemapUrls)];
  const collections = new Map();
  const items = [];
  const navigation = [];

  console.log(`\nProbing ${allUrls.length} URLs for content metadata...`);

  for (let i = 0; i < allUrls.length; i++) {
    const url = allUrls[i];
    const path = new URL(url).pathname;
    if (path === "/page-not-found" || path === "/config") continue;

    process.stdout.write(`  [${i + 1}/${allUrls.length}] ${path}... `);
    const data = await fetchJSON(url, cookieStr);
    if (!data) {
      console.log("skip");
      continue;
    }

    const collection = data.collection || {};
    const collId = collection.id;

    if (data.item) {
      const item = data.item;
      const parentType = classify(
        collection.type,
        collection.fullUrl || path,
        collection.typeName,
      );
      const itemType = classifyCollectionItem(parentType, item);

      items.push({
        url,
        path,
        type: itemType,
        title: item.title || path,
        collectionId: collId,
        collectionTitle: collection.title,
        publishDate: item.publishOn ? new Date(item.publishOn).toISOString() : null,
        hasBody: !!item.body,
        hasImage: !!item.assetUrl,
        tags: item.tags || [],
        categories: item.categories || [],
      });

      console.log(`${itemType} (in ${collection.title || "unknown"})`);
    } else if (!collections.has(collId)) {
      const collType = collection.type;
      const typeName = classify(collType, path, collection.typeName);
      const collItems = data.items || [];

      const entry = {
        url,
        path,
        type: typeName,
        collectionType: collType,
        collectionId: collId,
        title: collection.navigationTitle || collection.title || path,
        itemCount: collection.itemCount || 0,
        hasMainContent: !!collection.mainContent,
        fetchedItems: collItems.length,
        tags: collection.tags || [],
        categories: collection.categories || [],
        passwordProtected: !!collection.passwordProtected,
      };

      if (collection.passwordProtected) {
        console.log(`  [!] Password-protected: ${path}`);
      }

      if (typeName === "products") {
        entry.commerceNote =
          "Full product data (variants, pricing, inventory) is usually richer in admin mode";
      }

      if (collItems.length > 0) {
        entry.items = collItems.map((item) => ({
          url: `${origin}${item.fullUrl}`,
          title: item.title,
          type: classifyCollectionItem(typeName, item),
          publishDate: item.publishOn ? new Date(item.publishOn).toISOString() : null,
        }));
      }

      if (collection.collections) {
        entry.subCollections = collection.collections.map((sub) => ({
          title: sub.navigationTitle || sub.title,
          url: `${origin}${sub.fullUrl || `/${sub.urlId}`}`,
          type: sub.typeName || COLLECTION_TYPES[sub.type] || "page",
        }));
      }

      collections.set(collId, entry);
      navigation.push({
        text: collection.navigationTitle || collection.title || path,
        href: url,
        type: typeName,
      });

      console.log(`${typeName} (${entry.itemCount} items)`);
    } else {
      console.log(`duplicate (${collection.title || collId})`);
    }

    if (i < allUrls.length - 1) await sleep(300);
  }

  for (const entry of collections.values()) {
    if (
      entry.itemCount > 20 &&
      entry.items &&
      entry.items.length < entry.itemCount
    ) {
      console.log(
        `\n  ${entry.path} has ${entry.itemCount} items, fetched ${entry.items.length} — getting more...`,
      );

      let pageNumber = 2;
      let fetched = entry.items.length;
      while (fetched < entry.itemCount) {
        const pageData = await fetchJSON(`${entry.url}?page=${pageNumber}`, cookieStr);
        if (!pageData?.items?.length) break;

        for (const item of pageData.items) {
          entry.items.push({
            url: `${origin}${item.fullUrl}`,
            title: item.title,
            type: classifyCollectionItem(entry.type, item),
            publishDate: item.publishOn ? new Date(item.publishOn).toISOString() : null,
          });
        }

        fetched += pageData.items.length;
        pageNumber++;
        await sleep(300);
      }

      entry.fetchedItems = entry.items.length;
      console.log(`    Now have ${entry.items.length} items`);
    }
  }

  const counts = {};
  const allContentUrls = [];
  for (const entry of collections.values()) {
    counts[entry.type] = (counts[entry.type] || 0) + 1;
    allContentUrls.push({ url: entry.url, type: entry.type, title: entry.title });

    for (const item of entry.items || []) {
      counts[item.type] = (counts[item.type] || 0) + 1;
      allContentUrls.push({ url: item.url, type: item.type, title: item.title });
    }
  }

  const urlsSeen = new Set(allContentUrls.map((item) => item.url));
  for (const item of items) {
    if (urlsSeen.has(item.url)) continue;
    counts[item.type] = (counts[item.type] || 0) + 1;
    allContentUrls.push({ url: item.url, type: item.type, title: item.title });
    urlsSeen.add(item.url);
  }

  const navSeen = new Set();
  const dedupedNav = navigation.filter((item) => {
    if (navSeen.has(item.href)) return false;
    navSeen.add(item.href);
    return true;
  });

  return {
    siteUrl: origin,
    siteName: website.siteTitle || "",
    websiteId: website.id || "",
    squarespaceVersion: sqVersion,
    discoveredAt: new Date().toISOString(),
    platform: "squarespace",
    discoveryMethod: "public-json",
    navigation: dedupedNav,
    counts,
    collections: [...collections.values()],
    urls: allContentUrls,
  };
}

function isAdminApiUrl(url) {
  return (
    url.startsWith("https://www.squarespace.com/api/") ||
    url.startsWith(`https://${targetHost}/api/`) ||
    url.includes("/api/content/") ||
    url.includes("/api/commondata/")
  );
}

function normalizeSiteUrl(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes("/config/pages")) return null;

  try {
    const absolute = new URL(trimmed, origin);
    if (absolute.host !== targetHost) return null;
    if (
      absolute.pathname.startsWith("/api/") ||
      absolute.pathname.includes("/scripts/") ||
      absolute.pathname.includes("/assets/") ||
      absolute.pathname.includes("/styles/") ||
      absolute.pathname.includes("/fonts/") ||
      absolute.pathname.includes("/static/")
    ) {
      return null;
    }
    if (
      absolute.pathname.match(
        /\.(jpg|jpeg|png|gif|webp|svg|avif|ico|js|css|map|json|txt|xml|pdf|woff2?|ttf|eot)$/i,
      )
    ) {
      return null;
    }
    absolute.hash = "";
    return absolute.toString();
  } catch {
    return null;
  }
}

function normalizeAdminType(rawType, url) {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return "/";
    }
  })();

  if (typeof rawType === "number") return classify(rawType, path, null);
  if (typeof rawType === "string") return classify(null, path, rawType);
  return classify(null, path, null);
}

function looksLikePageObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.assetUrl || value.scriptUrl || value.mimeType || value.contentType) return false;
  const hasUrlLikeField = [
    value.fullUrl,
    value.publicUrl,
    value.pageUrl,
    value.path,
    value.url,
    value.href,
    value.slug,
  ].some(Boolean);
  const hasLabel = [value.title, value.navigationTitle, value.name].some(Boolean);
  const hasId = [value.id, value.pageId, value.collectionId].some(Boolean);
  return hasUrlLikeField && (hasLabel || hasId);
}

function extractAdminEntriesFromValue(rootValue) {
  const entries = new Map();
  const visited = new WeakSet();

  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (looksLikePageObject(value)) {
      const url = normalizeSiteUrl(
        value.fullUrl ||
          value.publicUrl ||
          value.pageUrl ||
          value.path ||
          value.url ||
          value.href ||
          value.slug,
      );
      if (url) {
        const title = value.navigationTitle || value.title || value.name || new URL(url).pathname;
        const adminPageId = value.pageId || value.collectionId || value.id || null;
        const visibility = value.published === false
          ? "draft"
          : value.showInNavigation === false || value.navigationHidden || value.unlinked
            ? "unlinked"
            : value.passwordProtected
              ? "password-protected"
              : "published";

        entries.set(url, {
          url,
          title,
          type: normalizeAdminType(
            value.typeName || value.pageType || value.type || value.collectionType,
            url,
          ),
          adminPageId: adminPageId ? String(adminPageId) : null,
          visibility,
          parentId: value.parentId ? String(value.parentId) : null,
          pageStatus: value.status || null,
        });
      }
    }

    for (const child of Object.values(value)) visit(child);
  }

  visit(rootValue);
  return [...entries.values()];
}

async function connectToCdpPage(port) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] || (await browser.newContext());
  const existingPage = context.pages().find((candidate) => {
    const url = candidate.url();
    return url.startsWith(`${origin}/config`);
  });
  const page = existingPage || (await context.newPage());
  return { browser, context, page };
}

async function openAdminSurface(page, candidates) {
  for (const candidate of candidates) {
    await page.goto(candidate, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await sleep(3000);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await sleep(1000);

    const noPermissions = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      return /No Permissions/i.test(text) || /do not have permission/i.test(text);
    }).catch(() => false);

    if (!noPermissions) return candidate;
  }

  throw new Error("Could not open a site admin surface without a No Permissions response");
}

async function discoverAdmin(port) {
  console.log("\nConnecting to Squarespace admin via CDP...");
  const { browser, page } = await connectToCdpPage(port);
  const apiCalls = [];

  const responseHandler = async (response) => {
    const responseUrl = response.url();
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("application/json") || !isAdminApiUrl(responseUrl)) return;

    try {
      const data = await response.json();
      apiCalls.push({ url: responseUrl, data });
    } catch {}
  };

  page.on("response", responseHandler);

  try {
    const adminUrl = await openAdminSurface(page, [`${origin}/config/pages`, `${origin}/config/`]);

    const nextData = await page.evaluate(() => window.__NEXT_DATA__ || null).catch(() => null);
    const domEntries = await page.evaluate(() => {
      return [...document.querySelectorAll("a[href*='/config/pages/']")]
        .map((link) => {
          const href = link.getAttribute("href") || "";
          const idMatch = href.match(/\/config\/pages\/([^/?#]+)/);
          const title = link.textContent?.trim();
          if (!idMatch || !title) return null;
          return { adminPageId: idMatch[1], title };
        })
        .filter(Boolean);
    }).catch(() => []);

    const entries = [
      ...extractAdminEntriesFromValue(apiCalls),
      ...extractAdminEntriesFromValue(nextData),
    ];

    const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
    for (const domEntry of domEntries) {
      const existing = [...byUrl.values()].find(
        (entry) => entry.adminPageId && entry.adminPageId === domEntry.adminPageId,
      );
      if (existing && !existing.title) existing.title = domEntry.title;
    }

    return {
      urls: [...byUrl.values()],
      adminUrl,
      apiCallCount: apiCalls.length,
      domEntryCount: domEntries.length,
      nextDataPresent: !!nextData,
    };
  } finally {
    page.off("response", responseHandler);
    await browser.close();
  }
}

export function mergeInventory(publicInventory, adminInventory) {
  if (!adminInventory?.urls?.length) return publicInventory;

  const publicUrlByCollectionId = new Map(
    (publicInventory.collections || [])
      .filter((item) => item?.collectionId && item?.url)
      .map((item) => [String(item.collectionId), item.url]),
  );
  const mergedUrls = new Map(
    publicInventory.urls.map((item) => [item.url, { ...item }]),
  );
  for (const adminEntry of adminInventory.urls) {
    const publicAliasUrl = adminEntry.adminPageId
      ? publicUrlByCollectionId.get(String(adminEntry.adminPageId))
      : null;
    if (publicAliasUrl && publicAliasUrl !== adminEntry.url) {
      mergedUrls.delete(publicAliasUrl);
    }

    const existing = mergedUrls.get(adminEntry.url) || {};
    mergedUrls.set(adminEntry.url, {
      ...existing,
      ...adminEntry,
      type: adminEntry.type || existing.type || "page",
      title: adminEntry.title || existing.title,
    });
  }

  const navigation = [...publicInventory.navigation];
  for (const [collectionId, publicAliasUrl] of publicUrlByCollectionId.entries()) {
    const adminReplacement = adminInventory.urls.find((entry) => entry.adminPageId === collectionId);
    if (adminReplacement && adminReplacement.url !== publicAliasUrl) {
      const aliasIndex = navigation.findIndex((item) => item.href === publicAliasUrl);
      if (aliasIndex !== -1) navigation.splice(aliasIndex, 1);
    }
  }
  const navSeen = new Set(navigation.map((item) => item.href));
  for (const entry of adminInventory.urls) {
    if (entry.visibility === "unlinked" || entry.visibility === "draft") continue;
    if (navSeen.has(entry.url)) continue;
    navigation.push({ text: entry.title, href: entry.url, type: entry.type });
    navSeen.add(entry.url);
  }

  const counts = {};
  for (const item of mergedUrls.values()) {
    counts[item.type || "page"] = (counts[item.type || "page"] || 0) + 1;
  }

  return {
    ...publicInventory,
    discoveredAt: new Date().toISOString(),
    discoveryMethod: "cdp-admin",
    navigation,
    counts,
    urls: [...mergedUrls.values()],
    adminDiscovery: {
      adminUrl: adminInventory.adminUrl,
      apiCallCount: adminInventory.apiCallCount,
      domEntryCount: adminInventory.domEntryCount,
      nextDataPresent: adminInventory.nextDataPresent,
    },
  };
}

function printSummary(inventory) {
  console.log("\n" + "=".repeat(50));
  console.log("Inventory summary:");
  for (const [type, count] of Object.entries(inventory.counts)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`\nTotal: ${inventory.urls.length} content URLs`);
  if (inventory.navigation.length) {
    console.log(`\nNavigation (${inventory.navigation.length} items):`);
    for (const item of inventory.navigation) {
      console.log(`  ${item.text} -> ${item.href} (${item.type})`);
    }
  }
  console.log("=".repeat(50));
}

async function main() {
  console.log(`Discovering: ${siteUrl}\n`);

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

  const publicInventory = await discoverPublic(cookieStr);
  let inventory = publicInventory;

  if (cdpAdmin) {
    try {
      const adminInventory = await discoverAdmin(cdpPort);
      inventory = mergeInventory(publicInventory, adminInventory);
      console.log(`\nAdmin mode found ${adminInventory.urls.length} candidate URLs`);
    } catch (e) {
      console.error(`\nAdmin discovery failed: ${e.message}`);
      console.error("Continuing with public discovery results only");
    }
  }

  writeFileSync("output/inventory.json", JSON.stringify(inventory, null, 2));
  printSummary(inventory);
  console.log("\nWritten to output/inventory.json");
  console.log("Review this inventory before running extract.js");
}

if (isMainModule) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
