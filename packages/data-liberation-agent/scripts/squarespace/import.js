#!/usr/bin/env node
/**
 * import.js — Step 3: Import Squarespace content to WordPress.com
 *
 * Reads output/ from extract.js and publishes to WordPress.com via REST API.
 * Import order: media → pages → posts → menus
 *
 * Usage:
 *   node scripts/squarespace/import.js --site mysite.wordpress.com --username your-wpcom-user --token APP_PASSWORD
 *   node scripts/squarespace/import.js --site mysite.wordpress.com --username your-wpcom-user --token APP_PASSWORD --dry-run
 *
 * Options:
 *   --site <domain>    WordPress.com site domain (e.g. mysite.wordpress.com)
 *   --username <name>  WordPress.com username that owns the application password
 *   --token <token>    Application password from wordpress.com/me/security/application-passwords
 *   --dry-run          Show what would be imported without actually doing it
 *   --only <type>      Only import 'media', 'pages', or 'posts'
 *
 * Getting your application password:
 *   1. Go to wordpress.com/me/security/application-passwords
 *   2. Create a new application password
 *   3. Copy the password and pass it as --token
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { pathToFileURL } from "url";

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}

const site = getArg("--site");
const username = getArg("--username");
const token = getArg("--token");
const dryRun = args.includes("--dry-run");
const only = getArg("--only");
const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMainModule && (!site || !username || !token)) {
  console.error(
    "Usage: node scripts/squarespace/import.js --site <wordpress-site> --username <wpcom-user> --token <app-password>",
  );
  console.error(
    "  Get your app password at: wordpress.com/me/security/application-passwords",
  );
  process.exit(1);
}

const PAGE_TYPES = new Set([
  "page",
  "homepage",
  "index",
  "gallery",
  "portfolio",
  "event",
  "events",
  "album",
]);
const POST_TYPES = new Set(["blog-post"]);
const PRODUCT_TYPES = new Set(["product", "products"]);

const apiBase = `https://public-api.wordpress.com/rest/v1.1/sites/${site}`;
const xmlRpcUrl = `https://${site}/xmlrpc.php`;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toIso8601(dateString) {
  if (!dateString) return null;
  return new Date(dateString)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function xmlValue(value) {
  if (value == null) return "<nil/>";
  if (Buffer.isBuffer(value))
    return `<base64>${value.toString("base64")}</base64>`;
  if (value instanceof Date)
    return `<dateTime.iso8601>${toIso8601(value.toISOString())}</dateTime.iso8601>`;
  if (typeof value === "boolean") return `<boolean>${value ? 1 : 0}</boolean>`;
  if (typeof value === "number")
    return Number.isInteger(value)
      ? `<int>${value}</int>`
      : `<double>${value}</double>`;
  if (Array.isArray(value)) {
    return `<array><data>${value.map((item) => `<value>${xmlValue(item)}</value>`).join("")}</data></array>`;
  }
  if (typeof value === "object") {
    return `<struct>${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(
        ([key, item]) =>
          `<member><name>${escapeXml(key)}</name><value>${xmlValue(item)}</value></member>`,
      )
      .join("")}</struct>`;
  }
  return `<string>${escapeXml(value)}</string>`;
}

function parseSimpleXmlRpcValue(xml) {
  const faultMatch = xml.match(
    /<fault>[\s\S]*?<name>faultString<\/name>\s*<value><string>([\s\S]*?)<\/string><\/value>[\s\S]*?<\/fault>/,
  );
  if (faultMatch) throw new Error(faultMatch[1]);

  const struct = {};
  const namedStringRegex =
    /<name>([^<]+)<\/name>\s*<value><string>([\s\S]*?)<\/string><\/value>/g;
  const namedIntRegex =
    /<name>([^<]+)<\/name>\s*<value><(?:int|i4)>([\s\S]*?)<\/(?:int|i4)><\/value>/g;
  const namedBoolRegex =
    /<name>([^<]+)<\/name>\s*<value><boolean>([01])<\/boolean><\/value>/g;
  let member;
  while ((member = namedStringRegex.exec(xml))) struct[member[1]] = member[2];
  while ((member = namedIntRegex.exec(xml)))
    struct[member[1]] = Number(member[2]);
  while ((member = namedBoolRegex.exec(xml)))
    struct[member[1]] = member[2] === "1";
  if (Object.keys(struct).length) return struct;

  const stringMatch = xml.match(/<string>([\s\S]*?)<\/string>/);
  if (stringMatch) return stringMatch[1];
  const intMatch = xml.match(/<(?:int|i4)>([\s\S]*?)<\/(?:int|i4)>/);
  if (intMatch) return Number(intMatch[1]);
  const boolMatch = xml.match(/<boolean>([01])<\/boolean>/);
  if (boolMatch) return boolMatch[1] === "1";

  return null;
}

async function xmlRpcCall(methodName, params) {
  const body = `<?xml version="1.0"?><methodCall><methodName>${methodName}</methodName><params>${params
    .map((param) => `<param><value>${xmlValue(param)}</value></param>`)
    .join("")}</params></methodCall>`;

  const res = await fetch(xmlRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${methodName} → ${res.status}: ${text}`);
  return parseSimpleXmlRpcValue(text);
}

let cachedBlogId = null;
async function getBlogId() {
  if (cachedBlogId) return cachedBlogId;
  const res = await fetch(apiBase);
  const data = await res.json().catch(() => ({}));
  if (!data.ID) throw new Error(`Could not determine site ID for ${site}`);
  cachedBlogId = data.ID;
  return cachedBlogId;
}

// Extract clean text content from accessibility tree nodes
function buildContentFromAccessibility(nodes) {
  if (!nodes?.length) return "";
  const blocks = [];
  for (const node of nodes) {
    if (!node.name) continue;
    if (node.role === "heading") {
      // Guess heading level from name length (crude but works as fallback)
      blocks.push(`<h2>${node.name}</h2>`);
    } else if (
      ["paragraph", "StaticText", "article", "section"].includes(node.role)
    ) {
      blocks.push(`<p>${node.name}</p>`);
    } else if (node.role === "img" && node.description) {
      blocks.push(`<!-- image: ${node.description} -->`);
    }
  }
  return blocks.join("\n");
}

// Extract the best available content from a page JSON file
export function extractContent(pageData) {
  // Direct content field (Squarespace extract.js produces this)
  if (pageData.content) return pageData.content;

  for (const call of pageData.apiCalls || []) {
    // Blog post body is typically in post.content or post.richContent
    const body =
      call.data?.post?.content?.plainText ||
      call.data?.post?.richContent ||
      call.data?.content?.plainText;
    if (body)
      return typeof body === "string" ? `<p>${body}</p>` : JSON.stringify(body);
  }

  // JSON-LD article body
  const article = pageData.globals?.jsonLd?.find(
    (j) => j["@type"] === "Article" || j["@type"] === "BlogPosting",
  );
  if (article?.articleBody) return `<p>${article.articleBody}</p>`;

  // Fallback to accessibility tree
  return buildContentFromAccessibility(pageData.accessibility);
}

export function extractMeta(pageData) {
  return {
    title: pageData.title || pageData.slug,
    description: pageData.description || "",
    featuredImageUrl: pageData.featuredImage || null,
    publishDate: pageData.publishDate || null,
    modifiedDate: pageData.modifiedDate || null,
    slug: pageData.slug,
    tags: pageData.tags || [],
    categories: pageData.categories || [],
  };
}

function guessMimeType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".avif")) return "image/avif";
  return "application/octet-stream";
}

async function uploadMedia(filePath, filename) {
  if (dryRun) {
    console.log(`  [dry-run] Would upload: ${filename}`);
    return {
      id: 0,
      source_url: `https://example.com/wp-content/uploads/${filename}`,
    };
  }
  const fileBuffer = readFileSync(filePath);
  const blogId = await getBlogId();
  const result = await xmlRpcCall("wp.uploadFile", [
    blogId,
    username,
    token,
    {
      name: filename,
      type: guessMimeType(filename),
      bits: fileBuffer,
      overwrite: true,
    },
  ]);

  return {
    id: result.id || 0,
    source_url: result.url,
  };
}

function loadOriginalMediaUrlsByFile() {
  const byFile = {};
  if (!existsSync("output/extraction-log.json")) return byFile;

  try {
    const log = JSON.parse(readFileSync("output/extraction-log.json", "utf8"));
    for (const item of log.mediaDownloaded || []) {
      if (!item?.file || !item?.url) continue;
      const filename = item.file.split("/").pop();
      if (!filename) continue;
      byFile[filename] ||= [];
      byFile[filename].push(item.url);
    }
  } catch (e) {
    console.warn(`Could not read output/extraction-log.json: ${e.message}`);
  }

  return byFile;
}

async function importMedia() {
  if (!existsSync("output/media")) {
    console.log("No media folder found.");
    return {};
  }

  const files = readdirSync("output/media");
  console.log(`\nUploading ${files.length} media files...`);

  const mediaMap = {};
  const originalUrlsByFile = loadOriginalMediaUrlsByFile();
  for (const file of files) {
    process.stdout.write(`  ${file}... `);
    try {
      const result = await uploadMedia(`output/media/${file}`, file);
      for (const originalUrl of originalUrlsByFile[file] || []) {
        mediaMap[originalUrl] = result.source_url;
      }
      console.log(`\u2713 ${result.source_url}`);
    } catch (e) {
      console.log(`\u2717 ${e.message}`);
    }
  }
  return mediaMap;
}

export function replaceMediaUrls(content, mediaMap) {
  if (!content) return "";

  let nextContent = content;
  const entries = Object.entries(mediaMap).sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [originalUrl, wpUrl] of entries) {
    nextContent = nextContent.replaceAll(originalUrl, wpUrl);
  }
  return nextContent;
}

export function classifyFilesForImport(
  pageFiles,
  pageDataByFile,
  inventoryTypeMap = {},
) {
  const typeMap = {};

  for (const file of pageFiles) {
    const slug = file.replace(".json", "");
    const pageData = pageDataByFile[file] || null;
    typeMap[slug] = pageData?.type || inventoryTypeMap[slug] || null;
  }

  const pages = pageFiles.filter((file) => {
    const slug = file.replace(".json", "");
    return !typeMap[slug] || PAGE_TYPES.has(typeMap[slug]);
  });
  const posts = pageFiles.filter((file) => {
    const slug = file.replace(".json", "");
    return POST_TYPES.has(typeMap[slug]);
  });
  const products = pageFiles.filter((file) => {
    const slug = file.replace(".json", "");
    return PRODUCT_TYPES.has(typeMap[slug]);
  });
  const unsupported = pageFiles.filter(
    (file) =>
      !pages.includes(file) &&
      !posts.includes(file) &&
      !products.includes(file),
  );

  return { typeMap, pages, posts, products, unsupported };
}

async function importPage(pageData, mediaMap) {
  const meta = extractMeta(pageData);
  const content = replaceMediaUrls(extractContent(pageData), mediaMap);

  if (dryRun) {
    console.log(`  [dry-run] Would create page: ${meta.title} (${meta.slug})`);
    return { id: 0, link: "#" };
  }

  const blogId = await getBlogId();
  const id = await xmlRpcCall("wp.newPost", [
    blogId,
    username,
    token,
    {
      post_type: "page",
      post_status: "draft",
      post_title: meta.title,
      post_content: content,
      post_excerpt: meta.description,
      wp_slug: meta.slug,
    },
  ]);

  return {
    id,
    link: `https://${site}/wp-admin/post.php?post=${id}&action=edit`,
  };
}

async function importPost(pageData, mediaMap) {
  const meta = extractMeta(pageData);
  const content = replaceMediaUrls(extractContent(pageData), mediaMap);

  if (dryRun) {
    console.log(`  [dry-run] Would create post: ${meta.title} (${meta.slug})`);
    return { id: 0, link: "#" };
  }

  const blogId = await getBlogId();
  const id = await xmlRpcCall("wp.newPost", [
    blogId,
    username,
    token,
    {
      post_type: "post",
      post_status: "draft",
      post_title: meta.title,
      post_content: content,
      post_excerpt: meta.description,
      wp_slug: meta.slug,
      post_date: meta.publishDate ? new Date(meta.publishDate) : undefined,
      terms_names:
        meta.categories?.length || meta.tags?.length
          ? {
              category: meta.categories || [],
              post_tag: meta.tags || [],
            }
          : undefined,
    },
  ]);

  return {
    id,
    link: `https://${site}/wp-admin/post.php?post=${id}&action=edit`,
  };
}

async function main() {
  if (dryRun) console.log("[DRY RUN — no changes will be made]\n");

  if (!existsSync("output/pages")) {
    console.error("No output/pages directory found. Run extract.js first.");
    process.exit(1);
  }

  const pageFiles = readdirSync("output/pages").filter((f) =>
    f.endsWith(".json"),
  );
  console.log(`Found ${pageFiles.length} extracted pages`);

  const inventoryTypeMap = {};
  if (existsSync("output/inventory.json")) {
    const inventory = JSON.parse(readFileSync("output/inventory.json", "utf8"));
    for (const item of inventory.urls) {
      const slug =
        new URL(item.url).pathname.replace(/^\//, "").replace(/\//g, "--") ||
        "homepage";
      inventoryTypeMap[slug] = item.type;
    }
  }

  const pageDataByFile = new Map();
  const urlMap = [];

  let mediaMap = {};
  if (!only || only === "media") {
    mediaMap = await importMedia();
  }

  for (const file of pageFiles) {
    try {
      const pd = JSON.parse(readFileSync(`output/pages/${file}`, "utf8"));
      pageDataByFile.set(file, pd);
    } catch {}
  }

  const { typeMap, pages, posts, products, unsupported } =
    classifyFilesForImport(
      pageFiles,
      Object.fromEntries(pageDataByFile),
      inventoryTypeMap,
    );

  if (!only || only === "pages") {
    console.log(`\nImporting ${pages.length} pages...`);
    for (const file of pages) {
      const pageData =
        pageDataByFile.get(file) ||
        JSON.parse(readFileSync(`output/pages/${file}`, "utf8"));
      const slug = file.replace(".json", "");
      process.stdout.write(`  ${slug}... `);
      try {
        const result = await importPage(pageData, mediaMap);
        console.log(`\u2713 ${result.link}`);
        if (pageData.sourceUrl)
          urlMap.push({ old: pageData.sourceUrl, new: result.link });
      } catch (e) {
        console.log(`\u2717 ${e.message}`);
      }
    }
  }

  if (!only || only === "posts") {
    console.log(`\nImporting ${posts.length} blog posts...`);
    for (const file of posts) {
      const pageData =
        pageDataByFile.get(file) ||
        JSON.parse(readFileSync(`output/pages/${file}`, "utf8"));
      const slug = file.replace(".json", "");
      process.stdout.write(`  ${slug}... `);
      try {
        const result = await importPost(pageData, mediaMap);
        console.log(`\u2713 ${result.link}`);
        if (pageData.sourceUrl)
          urlMap.push({ old: pageData.sourceUrl, new: result.link });
      } catch (e) {
        console.log(`\u2717 ${e.message}`);
      }
    }
  }

  if (!only || only === "pages" || only === "posts") {
    if (products.length) {
      console.log(
        `\nSkipped ${products.length} product records (WooCommerce import is out of scope):`,
      );
      for (const file of products) {
        const pageData = pageDataByFile.get(file);
        const title = pageData?.title || file.replace(".json", "");
        console.log(`  ${title} [${typeMap[file.replace(".json", "")]}]`);
      }
    }

    if (unsupported.length) {
      console.log(
        `\nSkipped ${unsupported.length} records with unsupported types:`,
      );
      for (const file of unsupported) {
        console.log(
          `  ${file.replace(".json", "")} [${typeMap[file.replace(".json", "")] || "unknown"}]`,
        );
      }
    }
  }

  if (urlMap.length) {
    const { writeFileSync } = await import("fs");
    writeFileSync("output/redirect-map.json", JSON.stringify(urlMap, null, 2));
    console.log(`\nRedirect map written to output/redirect-map.json`);
    console.log(
      "Use this to set up 301 redirects from your old site URLs to WordPress.",
    );
  }

  console.log(
    "\nImport complete. All content created as drafts — review in WordPress admin before publishing.",
  );
  console.log(`https://${site}/wp-admin/`);
}

if (isMainModule) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
