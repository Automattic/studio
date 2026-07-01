#!/usr/bin/env node
/**
 * import.js — Step 3: Import extracted content to WordPress.com
 *
 * Reads output/ from extract.js and publishes to WordPress.com via REST API.
 * Import order: media → pages → posts → menus
 *
 * Usage:
 *   node scripts/import.js --site mysite.wordpress.com --username your-wpcom-user --token APP_PASSWORD
 *   node scripts/import.js --site mysite.wordpress.com --username your-wpcom-user --token APP_PASSWORD --dry-run
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

if (!site || !username || !token) {
  console.error(
    "Usage: node scripts/import.js --site <wordpress-site> --username <wpcom-user> --token <app-password>",
  );
  console.error(
    "  Get your app password at: wordpress.com/me/security/application-passwords",
  );
  process.exit(1);
}

const apiBase = `https://public-api.wordpress.com/wp/v2/sites/${site}`;
const authHeader = `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;

async function wpRequest(method, endpoint, body, isFormData = false) {
  const headers = { Authorization: authHeader };
  if (!isFormData) headers["Content-Type"] = "application/json";

  const options = { method, headers };
  if (body) options.body = isFormData ? body : JSON.stringify(body);

  const res = await fetch(`${apiBase}${endpoint}`, options);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      `${method} ${endpoint} → ${res.status}: ${data.message || JSON.stringify(data)}`,
    );
  }
  return data;
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
function extractContent(pageData) {
  // Priority: Wix blog API response > JSON-LD > accessibility tree
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

function extractMeta(pageData) {
  const meta = pageData.globals?.meta || {};
  const jsonLd = pageData.globals?.jsonLd || [];
  const article = jsonLd.find((j) =>
    ["Article", "BlogPosting", "WebPage"].includes(j["@type"]),
  );

  return {
    title: meta.ogTitle || meta.title || article?.headline || pageData.slug,
    description:
      meta.description || meta.ogDescription || article?.description || "",
    featuredImageUrl: meta.ogImage || article?.image?.url || null,
    publishDate: article?.datePublished || null,
    modifiedDate: article?.dateModified || null,
    slug: pageData.slug,
  };
}

async function uploadMedia(filePath, filename) {
  if (dryRun) {
    console.log(`  [dry-run] Would upload: ${filename}`);
    return {
      id: 0,
      source_url: `https://example.com/wp-content/uploads/${filename}`,
    };
  }

  const FormData = (await import("node:buffer")).default;
  // Use fetch with FormData
  const formData = new globalThis.FormData();
  const fileBuffer = readFileSync(filePath);
  const blob = new Blob([fileBuffer]);
  formData.append("file", blob, filename);

  const res = await fetch(`${apiBase}/media`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Media upload failed: ${err.message || res.status}`);
  }
  return res.json();
}

async function importMedia() {
  if (!existsSync("output/media")) {
    console.log("No media folder found.");
    return {};
  }

  const files = readdirSync("output/media");
  console.log(`\nUploading ${files.length} media files...`);

  const mediaMap = {}; // original filename → WP media URL
  for (const file of files) {
    process.stdout.write(`  ${file}... `);
    try {
      const result = await uploadMedia(`output/media/${file}`, file);
      mediaMap[file] = result.source_url;
      console.log(`✓ ${result.source_url}`);
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
  return mediaMap;
}

async function importPage(pageData, mediaMap) {
  const meta = extractMeta(pageData);
  let content = extractContent(pageData);

  // Replace any Wix image URLs in content with uploaded WP URLs
  for (const [filename, wpUrl] of Object.entries(mediaMap)) {
    content = content.replaceAll(filename, wpUrl);
  }

  const body = {
    title: meta.title,
    content,
    excerpt: meta.description,
    slug: meta.slug,
    status: "draft", // Start as draft — user publishes manually after review
  };

  if (dryRun) {
    console.log(`  [dry-run] Would create page: ${meta.title} (${meta.slug})`);
    return { id: 0, link: "#" };
  }

  return wpRequest("POST", "/pages", body);
}

async function importPost(pageData, mediaMap) {
  const meta = extractMeta(pageData);
  let content = extractContent(pageData);

  for (const [filename, wpUrl] of Object.entries(mediaMap)) {
    content = content.replaceAll(filename, wpUrl);
  }

  const body = {
    title: meta.title,
    content,
    excerpt: meta.description,
    slug: meta.slug,
    status: "draft",
    date: meta.publishDate || undefined,
    modified: meta.modifiedDate || undefined,
  };

  if (dryRun) {
    console.log(`  [dry-run] Would create post: ${meta.title} (${meta.slug})`);
    return { id: 0, link: "#" };
  }

  return wpRequest("POST", "/posts", body);
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

  // Determine content type from inventory if available
  let typeMap = {};
  if (existsSync("output/inventory.json")) {
    const inventory = JSON.parse(readFileSync("output/inventory.json", "utf8"));
    for (const item of inventory.urls) {
      const slug =
        new URL(item.url).pathname.replace(/^\//, "").replace(/\//g, "--") ||
        "homepage";
      typeMap[slug] = item.type;
    }
  }

  const urlMap = []; // old URL → new WP URL, for redirect map

  // Step 1: Upload media
  let mediaMap = {};
  if (!only || only === "media") {
    mediaMap = await importMedia();
  }

  // Step 2: Import pages
  const pages = pageFiles.filter((f) => {
    const slug = f.replace(".json", "");
    return (
      !typeMap[slug] || typeMap[slug] === "page" || typeMap[slug] === "homepage"
    );
  });

  if (!only || only === "pages") {
    console.log(`\nImporting ${pages.length} pages...`);
    for (const file of pages) {
      const pageData = JSON.parse(readFileSync(`output/pages/${file}`, "utf8"));
      const slug = file.replace(".json", "");
      process.stdout.write(`  ${slug}... `);
      try {
        const result = await importPage(pageData, mediaMap);
        console.log(`✓ ${result.link}`);
        if (pageData.sourceUrl)
          urlMap.push({ old: pageData.sourceUrl, new: result.link });
      } catch (e) {
        console.log(`✗ ${e.message}`);
      }
    }
  }

  // Step 3: Import posts
  const posts = pageFiles.filter((f) => {
    const slug = f.replace(".json", "");
    return typeMap[slug] === "blog-post";
  });

  if (!only || only === "posts") {
    console.log(`\nImporting ${posts.length} blog posts...`);
    for (const file of posts) {
      const pageData = JSON.parse(readFileSync(`output/pages/${file}`, "utf8"));
      const slug = file.replace(".json", "");
      process.stdout.write(`  ${slug}... `);
      try {
        const result = await importPost(pageData, mediaMap);
        console.log(`✓ ${result.link}`);
        if (pageData.sourceUrl)
          urlMap.push({ old: pageData.sourceUrl, new: result.link });
      } catch (e) {
        console.log(`✗ ${e.message}`);
      }
    }
  }

  // Output redirect map
  if (urlMap.length) {
    const { writeFileSync } = await import("fs");
    writeFileSync("output/redirect-map.json", JSON.stringify(urlMap, null, 2));
    console.log(`\nRedirect map written to output/redirect-map.json`);
    console.log(
      "Use this to set up 301 redirects from your old Wix URLs to WordPress.",
    );
  }

  console.log(
    "\nImport complete. All content created as drafts — review in WordPress admin before publishing.",
  );
  console.log(`https://${site}/wp-admin/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
