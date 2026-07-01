// src/mcp-server.ts
//
// Thin router. Tool listing lives below; per-tool logic lives in
// src/mcp-server/handlers/<tool>.ts. The dispatch map at the bottom maps
// tool names to handler modules.
//
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { PlatformAdapter } from './types.js';

import type { Handler, HandlerContext, ToolResult } from './mcp-server/handler-types.js';
import { detectHandler } from './mcp-server/handlers/detect.js';
import { discoverHandler } from './mcp-server/handlers/discover.js';
import { inspectHandler } from './mcp-server/handlers/inspect.js';
import { extractHandler } from './mcp-server/handlers/extract.js';
import { extractOneHandler } from './mcp-server/handlers/extract-one.js';
import { mediaInstallHandler } from './mcp-server/handlers/media-install.js';
import { replicateTickHandler } from './mcp-server/handlers/replicate-tick.js';
import { blockTransformApplyHandler } from './mcp-server/handlers/block-transform-apply.js';
import { blockComposeHandler } from './mcp-server/handlers/block-compose.js';
import { qaHandler } from './mcp-server/handlers/qa.js';
import { mapApisHandler } from './mcp-server/handlers/map-apis.js';
import { probeHandler } from './mcp-server/handlers/probe.js';
import { verifyHandler } from './mcp-server/handlers/verify.js';
import { setupHandler } from './mcp-server/handlers/setup.js';
import { wpImportHandler } from './mcp-server/handlers/wp-import.js';
import { statusHandler } from './mcp-server/handlers/status.js';
import { pathsHandler } from './mcp-server/handlers/paths.js';
import { previewHandler } from './mcp-server/handlers/preview.js';
import { installThemeHandler } from './mcp-server/handlers/install-theme.js';
import { themeScaffoldHandler } from './mcp-server/handlers/theme-scaffold.js';
import { reconstructPagesHandler } from './mcp-server/handlers/reconstruct-pages.js';
import { reconstructPagesCarryHandler } from './mcp-server/handlers/reconstruct-pages-carry.js';
import { blockifyWxrHandler } from './mcp-server/handlers/blockify-wxr.js';
import { screenshotHandler } from './mcp-server/handlers/screenshot.js';
import { dataModelScaffoldHandler } from './mcp-server/handlers/data-model-scaffold.js';
import { designFoundationScaffoldHandler } from './mcp-server/handlers/design-foundation-scaffold.js';
import { designFoundationValidateHandler } from './mcp-server/handlers/design-foundation-validate.js';
import { designFoundationSaveHandler } from './mcp-server/handlers/design-foundation-save.js';
import { replicateInventoryHandler } from './mcp-server/handlers/replicate-inventory.js';
import { replicateVerifyHandler } from './mcp-server/handlers/replicate-verify.js';
import { compareHandler } from './mcp-server/handlers/compare.js';
import { clusterPagesHandler } from './mcp-server/handlers/cluster-pages.js';
import { sectionExtractHandler } from './mcp-server/handlers/section-extract.js';
import { composeInstantiateHandler } from './mcp-server/handlers/compose-instantiate.js';
import { ingestLocalSiteHandler } from './mcp-server/handlers/ingest-local-site.js';
import { convertLocalSiteHandler } from './mcp-server/handlers/convert-local-site.js';
import { validateArtifactsHandler } from './mcp-server/handlers/validate-artifacts.js';
import { refineReportHandler } from './mcp-server/handlers/refine-report.js';
import { NEW_TOOL_SCHEMAS } from './mcp-server/handlers/tool-schemas.js';

// Static adapter imports — add new adapters here (alphabetical)
import { defaultAdapter } from './adapters/default/index.js';
import { godaddyWmAdapter } from './adapters/godaddy-wm/index.js';
import { hostingerAdapter } from './adapters/hostinger/index.js';
import { hubspotAdapter } from './adapters/hubspot/index.js';
import { shopifyAdapter } from './adapters/shopify/index.js';
import { squarespaceAdapter } from './adapters/squarespace/index.js';
import { webflowAdapter } from './adapters/webflow/index.js';
import { weeblyAdapter } from './adapters/weebly/index.js';
import { wixAdapter } from './adapters/wix/index.js';
import { resolveAdapter } from './adapters/resolve-adapter.js';
const adapters: PlatformAdapter[] = [defaultAdapter, godaddyWmAdapter, hostingerAdapter, hubspotAdapter, shopifyAdapter, squarespaceAdapter, webflowAdapter, weeblyAdapter, wixAdapter];

function findAdapter(platform: string): PlatformAdapter | null {
  return resolveAdapter(adapters, platform);
}

function textResult(data: unknown): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

const server = new Server(
  { name: 'data-liberation', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'liberate_detect',
      description: 'Detect the platform of a website (GoDaddy Websites & Marketing, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix, or unknown)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'The URL of the website to detect' },
        },
        required: ['url'],
      },
    },
    {
      name: 'liberate_discover',
      description: 'Inventory a website: fetch sitemap, categorize URLs, extract navigation structure',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'The URL of the website to inventory' },
          token: { type: 'string', description: 'API token for platforms requiring auth' },
          cdpPort: { type: 'number', description: 'CDP port for browser-based extraction' },
          verbose: { type: 'boolean', description: 'Enable detailed logging' },
        },
        required: ['url'],
      },
    },
    {
      name: 'liberate_inspect',
      description: "Probe a site to assess extractability: detect platform, check sitemap, probe sample pages",
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'The URL of the website to inspect' },
          token: { type: 'string', description: 'API token if needed' },
          cdpPort: { type: 'number', description: 'CDP port for browser-based inspection' },
        },
        required: ['url'],
      },
    },
    {
      name: 'liberate_extract',
      description: 'Extract all content from a website. Produces WXR file + media directory + redirect map.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'The URL of the website to extract' },
          outputDir: { type: 'string', description: 'Directory to write WXR, media, and logs' },
          token: { type: 'string', description: 'API token for platforms requiring auth (e.g. Webflow)' },
          cdpPort: { type: 'number', description: 'CDP port for browser-based extraction' },
          adminToken: { type: 'string', description: 'Shopify Admin API access token. When set, products are fetched via the Shopify Admin GraphQL API for richer data (compareAtPrice, inventoryPolicy, unitCost, collections, SEO metafields, variant images). Falls back to the public JSON API on failure.' },
          shopDomain: { type: 'string', description: 'Shopify *.myshopify.com hostname. Usually auto-detected by liberate_discover from the storefront HTML; only pass explicitly if detection failed (e.g. Cloudflare-protected site).' },
          delay: { type: 'number', description: 'Delay between requests in ms (default: 500)' },
          resume: { type: 'boolean', description: 'Resume a previous extraction' },
          dryRun: { type: 'boolean', description: 'Extract 2-3 pages and report without writing WXR' },
          limit: { type: 'number', description: 'Cap extraction to the first N URLs and write a real WXR for them' },
          verbose: { type: 'boolean', description: 'Enable detailed per-page logging' },
          screenshots: { type: 'boolean', description: 'After extract completes, capture screenshots (desktop + mobile) for every processed URL. Results are written to output/<site>/screenshots/ with a manifest.json keyed by URL.' },
          captureDesign: { type: 'boolean', description: 'Enable html-first design replication: carry source HTML+CSS as the page/post design. Note: full html-first design capture (site.css aggregation, blank theme install) runs via the CLI (`data-liberation --html-first`); this flag is reserved for future MCP support.' },
          contentStatus: { type: 'string', enum: ['draft', 'publish'], description: 'WXR post status for extracted pages/posts. Default "draft" — the documented "import as drafts; the user reviews and publishes manually" convention for a production import. The replica/preview flow (e.g. building a Studio replica) passes "publish" so imported nav targets resolve. Attachments always use "inherit".' },
        },
        required: ['url', 'outputDir'],
      },
    },
    {
      name: 'liberate_extract_one',
      description: 'Extract a single URL through the streaming pipeline. Used by the watch loop and agent-driven streaming. Each call runs adapter discovery to set up state, then narrows to the target URL. Append-mode WXR — results accumulate in output.wxr across calls.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'The single URL to extract.' },
          outputDir: { type: 'string', description: 'Liberation output directory. WXR + media + logs are appended here.' },
          siteUrl: { type: 'string', description: 'Origin of the source site, used for adapter discovery. Defaults to the origin parsed from `url`.' },
          token: { type: 'string', description: 'API token for platforms requiring auth (e.g. Webflow).' },
          cdpPort: { type: 'number', description: 'CDP port for browser-based extraction.' },
          adminToken: { type: 'string', description: 'Shopify Admin API token (see liberate_extract).' },
          shopDomain: { type: 'string', description: 'Shopify *.myshopify.com hostname (see liberate_extract).' },
          delay: { type: 'number', description: 'Delay floor in ms.' },
          verbose: { type: 'boolean', description: 'Per-step logging.' },
          contentStatus: { type: 'string', enum: ['draft', 'publish'], description: 'WXR post status for extracted pages/posts. Default "draft" (import-as-drafts convention); the replica/preview flow passes "publish". Attachments always use "inherit".' },
        },
        required: ['url', 'outputDir'],
      },
    },
    {
      name: 'liberate_paths',
      description: 'Resolve where liberation output lives. Returns { base, siteDir }. base = the default output base (DLA_OUTPUT_DIR or <Studio root>/_liberations). siteDir = base/<sanitized host+path> when a url is given. Skills MUST use this instead of assuming output/<site>/ relative to cwd.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'Optional source URL; when present, siteDir is returned.' },
        },
      },
    },
    {
      name: 'liberate_status',
      description: 'Check progress of a running or completed extraction',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'The output directory of the extraction' },
        },
        required: ['outputDir'],
      },
    },
    {
      name: 'liberate_map_apis',
      description: 'Map all API endpoints used by a website by navigating pages via CDP and capturing JSON network traffic. Produces a categorized endpoint catalog with sample responses and auth headers. Use during /adapt reconnaissance to reverse-engineer a new platform.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cdpPort: { type: 'number', description: 'Chrome DevTools Protocol port (e.g. 9222)' },
          url: { type: 'string', description: 'The URL of the site to map' },
          crawlUrls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional URLs to navigate (e.g. admin dashboard sections)',
          },
          followLinks: { type: 'boolean', description: 'Follow same-origin links from the main page (up to 20, default: false)' },
        },
        required: ['cdpPort', 'url'],
      },
    },
    {
      name: 'liberate_probe',
      description: 'Probe a browser page via CDP for extraction-relevant data: window globals, JSON-LD, cookies, localStorage, network entries, and platform identity fields. Requires a running Chrome with --remote-debugging-port. Use for debugging extraction failures.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cdpPort: { type: 'number', description: 'Chrome DevTools Protocol port (e.g. 9222)' },
          url: { type: 'string', description: 'Only probe pages on this domain (optional — probes all tabs if omitted)' },
        },
        required: ['cdpPort'],
      },
    },
    {
      name: 'liberate_qa',
      description: 'Compare extracted WXR content against the original source site page by page. Reports text similarity, missing headings/images/links, and grades each page (pass/warn/fail). Optionally patches fixable issues like missing alt text.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          wxrFile: { type: 'string', description: 'Path to the WXR file to QA' },
          fix: { type: 'boolean', description: 'Patch fixable issues in the WXR (default: false)' },
        },
        required: ['wxrFile'],
      },
    },
    {
      name: 'liberate_verify',
      description: 'Verify a completed extraction: check for stale CDN URLs, failed pages, missing media, and items needing manual attention',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'The output directory of the extraction to verify' },
        },
        required: ['outputDir'],
      },
    },
    {
      name: 'liberate_setup',
      description: 'Validate WordPress connection: check site reachability, REST API, and authentication. Returns guidance if anything fails. Pass delegate: true to skip validation and receive a structured manifest describing what the import target needs — useful when the calling environment handles site setup itself.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          site: { type: 'string', description: 'WordPress site domain (e.g. mysite.com or localhost:8881)' },
          username: { type: 'string', description: 'WordPress username' },
          token: { type: 'string', description: 'WordPress application password' },
          delegate: { type: 'boolean', description: 'Skip validation and return a setup manifest for the calling environment to handle. Use when the environment has its own site management (e.g. local dev tools).' },
        },
        required: [],
      },
    },
    {
      name: 'liberate_import',
      description: 'Import a WXR file into a WordPress site. Pass delegate: true to skip REST import and receive a structured import manifest — useful when the calling environment handles imports itself (e.g. local dev tools with direct database/CLI access).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          wxrFile: { type: 'string', description: 'Path to the WXR file to import' },
          site: { type: 'string', description: 'WordPress site domain (e.g. example.com)' },
          username: { type: 'string', description: 'WordPress username' },
          token: { type: 'string', description: 'WordPress application password' },
          dryRun: { type: 'boolean', description: 'Preview without importing' },
          delay: { type: 'number', description: 'Delay between requests in ms (default: 500)' },
          only: { type: 'string', description: 'Only import specific type (categories, tags, media, pages, posts, comments, menus)' },
          verbose: { type: 'boolean', description: 'Enable detailed logging' },
          resume: { type: 'boolean', description: '(deprecated — import is always idempotent, this flag has no effect)' },
          importAuthors: { type: 'boolean', description: 'Create WordPress users for each author in the WXR (default: false — all content owned by authenticated user)' },
          woocommerceKey: { type: 'string', description: 'WooCommerce consumer key for product import' },
          woocommerceSecret: { type: 'string', description: 'WooCommerce consumer secret for product import' },
          delegate: { type: 'boolean', description: 'Skip REST import and return a structured import manifest for the calling environment to handle.' },
        },
        required: ['wxrFile'],
      },
    },
    {
      name: 'liberate_preview',
      description: 'Spawn a local Studio preview of an extraction output. Returns { url, port, status, warnings }. Kills any existing preview on the same outputDir before starting. Optionally installs a generated replica theme + block plugins via themeFiles[] + blockPlugins[]; the theme is activated after content import. Used by the replicate skill in Step 5 (Install).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Path to the extraction output directory (contains output.wxr).' },
          open: { type: 'boolean', description: 'If true, open the URL in the default browser after readiness.' },
          port: { type: 'number', description: 'Override the auto-picked port (default range: 9400-9499).' },
          themeFiles: {
            type: 'array',
            description: 'Generated replica theme files. Each entry is { relativePath, content } rooted at the theme directory (e.g. relativePath: "templates/index.html"). Theme is written to wp-content/themes/<themeSlug>/ and activated after content import.',
            items: {
              type: 'object' as const,
              properties: {
                relativePath: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['relativePath', 'content'],
            },
          },
          blockPlugins: {
            type: 'array',
            description: 'DEPRECATED — embed custom blocks inside the theme at blocks/<slug>/{src,build}/ via themeFiles[] instead (Telex blocks-inside-themes pattern, registered from functions.php). Kept for backwards compatibility. Each entry is { slug, files: [{relativePath, content}] }; plugin is written to wp-content/plugins/<slug>/ and activated.',
            items: {
              type: 'object' as const,
              properties: {
                slug: { type: 'string' },
                files: {
                  type: 'array',
                  items: {
                    type: 'object' as const,
                    properties: {
                      relativePath: { type: 'string' },
                      content: { type: 'string' },
                    },
                    required: ['relativePath', 'content'],
                  },
                },
              },
              required: ['slug', 'files'],
            },
          },
          themeSlug: { type: 'string', description: 'Theme directory name (kebab-case). Required when themeFiles is non-empty. Conventionally <siteSlug>-replica.' },
        },
        required: ['outputDir'],
      },
    },
    {
      name: 'liberate_install_theme',
      description: 'Install replica theme files + block plugins into an ALREADY-RUNNING Studio site (no site creation, no content import). Use this from the streaming watch loop\'s theme-piece / archetype-template judgments — `liberate_preview` would create a `-2` duplicate Studio site and re-import content over the streamed posts. Writes to <studioSitePath>/wordpress/wp-content/{themes,plugins}/, then runs `studio wp plugin activate` and `studio wp theme activate`. Returns warnings[] for non-fatal activate failures.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Path to the extraction output directory (used for log routing only — files are written to studioSitePath, not outputDir).' },
          studioSitePath: { type: 'string', description: 'On-disk path to the running Studio site (parent dir, NOT the wordpress sub-dir). Streaming watch logs this as `preview-pre-started.sitePath`.' },
          themeFiles: {
            type: 'array',
            description: 'Replica theme files. Same shape as liberate_preview — { relativePath, content }, rooted at the theme directory. Activated after writing.',
            items: {
              type: 'object' as const,
              properties: {
                relativePath: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['relativePath', 'content'],
            },
          },
          blockPlugins: {
            type: 'array',
            description: 'DEPRECATED — kept for backwards compatibility. New replica work should embed custom blocks inside the theme at blocks/<slug>/{src,build}/ via themeFiles[], following the Telex blocks-inside-themes pattern. The skill registers them from functions.php. Each plugin entry is { slug, files: [{relativePath, content}] }, activated after writing.',
            items: {
              type: 'object' as const,
              properties: {
                slug: { type: 'string' },
                files: {
                  type: 'array',
                  items: {
                    type: 'object' as const,
                    properties: {
                      relativePath: { type: 'string' },
                      content: { type: 'string' },
                    },
                    required: ['relativePath', 'content'],
                  },
                },
              },
              required: ['slug', 'files'],
            },
          },
          themeSlug: { type: 'string', description: 'Theme directory name (kebab-case). Required when themeFiles is non-empty. Conventionally <siteSlug>-replica.' },
        },
        required: ['outputDir', 'studioSitePath'],
      },
    },
    {
      name: 'liberate_theme_scaffold',
      description: 'Read <outputDir>/design-foundation.json and emit a complete-and-activatable WordPress block theme bundle deterministically: style.css (theme header), theme.json (settings/styles mapped from foundation tokens), functions.php (theme setup + custom-block registration loop), templates/index.html (homepage shell with header part + post-content + footer part), parts/header.html (site-title + page-list nav), parts/footer.html (copyright). No agent reasoning, no vision, no LLM call — pure deterministic mapping. Pair with `liberate_install_theme` to install the result into a running Studio site. Per-archetype templates (page.html, single.html, etc.) and patterns are NOT emitted here — they belong to the replicate skill\'s archetype-template tick.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory (must contain design-foundation.json).' },
          themeSlug: { type: 'string', description: 'Theme directory slug (kebab-case). Conventionally <siteSlug>-replica.' },
          themeName: { type: 'string', description: 'Display name. Defaults to themeSlug.' },
          siteTitle: { type: 'string', description: 'Source site title — used in style.css description and footer copyright.' },
          themeDescription: { type: 'string', description: 'Override the default style.css Description line.' },
          sourceUrl: { type: 'string', description: 'The source site origin (e.g. https://www.example.com/). Used to resolve the captured header/footer chrome links to absolute URLs so they remap to local permalinks (without it, nav hrefs are not remapped and point off-site). Defaults to a placeholder origin.' },
          persist: { type: 'boolean', description: 'When true, also write the emitted text theme files to <outputDir>/theme (alongside the font/logo assets always written there), materializing a complete on-disk theme. Default false: themeFiles[] is returned for the caller to install into a live site.' },
          reconstructedPages: {
            type: 'array',
            description: 'Block-reconstructed content pages. Each entry emits templates/page-<slug>.html wiring the page to its reconstructed pattern (and front-page.html for isHome), so the page renders block sections instead of falling through page.html to raw carried post_content. The pattern files (reconstructed block markup) are added to themeFiles[] separately by the replicate skill.',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string', description: 'Source-faithful WP page slug (last path segment), e.g. "about-us".' },
                patternSlug: { type: 'string', description: 'Fully-qualified theme pattern slug, e.g. "<themeSlug>/page-about-us".' },
                isHome: { type: 'boolean', description: 'When true, also emit templates/front-page.html for this page (static front page).' },
              },
              required: ['slug', 'patternSlug'],
            },
          },
        },
        required: ['outputDir', 'themeSlug'],
      },
    },
    {
      name: 'liberate_blockify_wxr',
      description: 'BULK blog-body block conversion (blocks reconstruct path ONLY). Rewrites every post/page content:encoded body in output.wxr through the source platform adapter\'s block recipe (seam 2) so imported posts land as editable Gutenberg blocks instead of one Classic block (e.g. Squarespace sqs-block bodies). Lossless: bodies the recipe can\'t convert are left verbatim, and all other items (attachments, nav menu items, comments, terms) are preserved unchanged. No-op when the platform adapter has no block recipe. Resolves the platform from session.json (recorded at extraction); pass `platform` to override. Run AFTER extraction and BEFORE liberate_import. The theme/carry path must NOT call this.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory holding output.wxr + session.json.' },
          wxrPath: { type: 'string', description: 'Override the WXR path. Defaults to <outputDir>/output.wxr.' },
          platform: { type: 'string', description: 'Override the platform adapter id (else read from session.json).' },
        },
        required: ['outputDir'],
      },
    },
    {
      name: 'liberate_reconstruct_pages',
      description: 'Deterministically reconstruct EVERY content page from its OWN captured section specs. For each page: capture specs, install section media, reconstruct verbatim block markup, GATE through validate_artifacts, write the pattern + reconstructed post_content. Page TEMPLATES are collapsed to a small set of variant templates (templates/page-replica[-<key>].html) registered in theme.json customTemplates and assigned per page via _wp_page_template; output.wxr is patched to match. Set collapseTemplates:false to fall back to one templates/page-<slug>.html per page. The theme shell must already be installed via liberate_theme_scaffold/install.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory (holds media/ + media-stubs.json).' },
          studioSitePath: { type: 'string', description: 'On-disk path to the running Studio site (e.g. ~/Studio/example-com).' },
          themeSlug: { type: 'string', description: 'Installed theme slug. Defaults to <siteSlug>-replica derived from outputDir.' },
          collapseTemplates: {
            type: 'boolean',
            description: 'Collapse per-page templates into variant-keyed templates + _wp_page_template assignments (default true). false = one template per page (legacy).',
          },
          variationHoist: { type: 'boolean', description: 'Hoist recurring instance-style constellations into theme block-style variations (default true). Set false to disable (escape hatch).' },
          editableIslands: { type: 'boolean', description: 'Convert the coverage-gated core/html fallback islands into in-canvas dla/editable-html blocks (visible + styled + text/image-editable in the block editor; ships + activates the block plugin). Default true. Set false to keep plain core/html.' },
          pages: {
            type: 'array',
            description: 'Content pages to reconstruct. Reconstruct every page (not just cluster reps).',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string', description: 'Source-faithful WP page slug (sanitize_title-shaped), e.g. "about-us".' },
                sourceUrl: { type: 'string', description: 'The page\'s source URL to capture + reconstruct.' },
                title: { type: 'string', description: 'Human-readable page title (pattern doc-comment).' },
                isHome: { type: 'boolean', description: 'When true, also emit front-page.html.' },
              },
              required: ['slug', 'sourceUrl', 'title'],
            },
          },
        },
        required: ['outputDir', 'studioSitePath', 'pages'],
      },
    },
    {
      name: 'liberate_reconstruct_pages_carry',
      description: 'Carry-and-scope parity path: for each page, load cached body HTML (or fetch live), collect CSS, carry the sanitized HTML + scoped CSS into core/html block islands, self-host the run media (rewriting <img>/srcset/url() to the local WP library) + localize internal links, write a carry FSE block theme under wp-content/themes/<siteSlug>-carry (incl. WooCommerce single-product/archive-product templates wrapping the carried header/footer when the run has products), and return per-page islands for building output-carry.wxr. Requires liberate_screenshot (html/ cache); falls back to live fetch. Pass islandsOutDir to write islands to disk and return paths instead of inline content (avoids the MCP response-size cap on large sites).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory (holds html/ cache from liberate_screenshot).' },
          studioSitePath: { type: 'string', description: 'On-disk path to the running Studio site (e.g. ~/Studio/example-com).' },
          themeName: { type: 'string', description: 'Display name for the carry theme (default: "Liberated (Carry)").' },
          islandsOutDir: { type: 'string', description: 'When set, write each carried island to <islandsOutDir>/<slug>.html and return its path + byte count instead of inline postContent. Use this from MCP to avoid the response-size cap (islands are whole page bodies). Omit to get postContent inline (the tsx driver default).' },
          editableIslands: { type: 'boolean', description: 'Emit carried bodies as in-canvas dla/editable-html blocks (visible + styled + text/image-editable in the block editor) instead of sandboxed core/html islands. Front-end output is byte-identical (static save). Ships + activates the block plugin. Default true; set false to force plain core/html.' },
          pages: {
            type: 'array',
            description: 'Content pages to carry and scope. Pass every page in the site for full coverage.',
            items: {
              type: 'object',
              properties: {
                slug: { type: 'string', description: 'URL-safe page slug (sanitize_title-shaped), e.g. "about-us". Must match the WP post_name so the island-swap finds the post and functions.php body-class scoping targets it.' },
                sourceUrl: { type: 'string', description: 'The page\'s source URL (used as base for CSS resolution and live HTML fallback).' },
                title: { type: 'string', description: 'Human-readable page title.' },
                isHome: { type: 'boolean', description: 'When true, emits front-page.html template and uses is_front_page() body-class condition.' },
                postType: { type: 'string', enum: ['page', 'post'], description: 'Post type (default "page"). "post" scopes via is_single() and renders through single.html; also selects the functions.php body-class condition.' },
                htmlSlug: { type: 'string', description: 'Override the cached-HTML filename stem loaded as html/<htmlSlug>.html when it differs from the WP slug — e.g. posts captured as "blogs--snoozweek--<name>" or pages as "pages--<name>". Falls back to slug; without it the tool live-fetches sourceUrl.' },
              },
              required: ['slug', 'sourceUrl', 'title'],
            },
          },
        },
        required: ['outputDir', 'studioSitePath', 'pages'],
      },
    },
    {
      name: 'liberate_screenshot',
      description: 'Capture full-page + scrolled screenshots (desktop + mobile) and rendered HTML for every URL on a site. Writes to <outputDir>/screenshots/ and <outputDir>/html/, plus palette.json, typography.json, breakpoints.json, and computed-styles.json via DOM/CSS site-analysis. Reuses sitemap discovery or accepts explicit urls[].',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'Site URL (used for sitemap discovery and same-origin enforcement)' },
          outputDir: { type: 'string', description: 'Output directory' },
          urls: { type: 'array', items: { type: 'string' }, description: 'Explicit URL list (skips sitemap fetch; all must share origin with `url` if both provided)' },
          types: { type: 'array', items: { type: 'string' }, description: 'Filter by URL type: page, post, product, homepage, gallery, event' },
          limit: { type: 'number', description: 'Cap to first N URLs' },
          concurrency: { type: 'number', description: 'Parallel URL captures (default 3, max 10)' },
          browserRestartEvery: { type: 'number', description: 'Close and relaunch browser every N URLs (default 100)' },
          cdpPort: { type: 'number', description: 'Connect to existing Chrome via CDP' },
          force: { type: 'boolean', description: 'Re-capture even if output files already exist' },
          verbose: { type: 'boolean', description: 'Per-URL progress logging' },
        },
        required: ['url', 'outputDir'],
      },
    },
    {
      name: 'liberate_data_model_scaffold',
      description:
        'Deterministic pre-pass for the JS-data path: reads an owned local site dir, discovers record arrays / mount containers / id-lookups by AST (resilient to malformed/vendored JS files), infers field roles, and writes a PARTIAL data-model.draft.json. Returns { model, skillTodos, discovered, validation }. The model-local-data skill fills only the skillTodos (card.template, ambiguous ordering, low-confidence role guesses), then writes the final data-model.json. Run before liberate_convert_local_site when the source renders content from a JS data array.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          dir: { type: 'string', description: 'Absolute path to the local static-site directory.' },
          outputDir: { type: 'string', description: 'Where data-model.draft.json is written. Defaults to dir.' },
        },
        required: ['dir'],
      },
    },
    {
      name: 'liberate_design_foundation_scaffold',
      description:
        'Runs the deterministic scaffold on a liberation output directory: reads palette.json / typography.json / breakpoints.json / screenshots/manifest.json from SP1 output, applies pure rules (darkest high-frequency → text.default, lightest → surface.base, breakpoint tier mapping, gradient regex extraction from html/*.html), and returns a PartialDesignFoundation. Empty role slots are left for the design-foundations skill to assign. Emits skillTodos listing every path the skill must fill. The design-foundations skill may additionally read computed-styles.json for HTML/CSS role assignment.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory (must contain SP1 files).' },
          origin: { type: 'string', description: 'Origin URL (e.g. https://example.com). Stored in the foundation `origin` field.' },
        },
        required: ['outputDir', 'origin'],
      },
    },
    {
      name: 'liberate_design_foundation_validate',
      description:
        'Validates a design-foundation JSON blob against the schema. Returns { ok: true } or { ok: false, errors: [...] }. Used by the design-foundations skill after filling role slots to catch structural mistakes and unfilled skillTodos before saving to disk.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          foundation: { type: 'object', description: 'JSON blob to validate (not a path).' },
        },
        required: ['foundation'],
      },
    },
    {
      name: 'liberate_design_foundation_save',
      description:
        'Persists a validated design-foundation JSON to disk and generates the human-readable design-foundation.md companion. Writes both files atomically to outputDir. Skips write when inputsDigest matches prior file (unless force=true).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Destination directory.' },
          foundation: { type: 'object', description: 'Complete design foundation JSON blob.' },
          force: { type: 'boolean', description: 'Overwrite even if inputsDigest matches prior file.' },
        },
        required: ['outputDir', 'foundation'],
      },
    },
    {
      name: 'liberate_media_install',
      description: 'Install one URL\'s pending media into the running replica WP site. Idempotent: skips media already registered as attachments (tracked via MediaStubStore.wpPostId). Uses `studio wp eval-file` to run a vendored PHP installer script.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory (contains media-stubs.json + media/).' },
          url: { type: 'string', description: 'Source URL whose media we are installing (used for logging; the install acts on all pending media in MediaStubStore).' },
          target: {
            type: 'object' as const,
            description: 'Where to install the media. Studio: { kind: "studio", sitePath: "/Users/.../Studio/site-name" }.',
            properties: {
              kind: { type: 'string', enum: ['studio'] },
              sitePath: { type: 'string' },
              siteUrl: { type: 'string', description: 'Optional site URL used to compute browser-visible upload URLs.' },
            },
            required: ['kind', 'sitePath'],
          },
        },
        required: ['outputDir', 'url', 'target'],
      },
    },
    {
      name: 'liberate_replicate_tick',
      description: 'Run one tick of the replicate streaming scheduler. Reads replicate-state.json, computes deltas (new archetypes since last tick, foundation drift), returns judgmentNeeded[] markers describing what skills the calling agent should invoke (replicate, design-foundations, compose-page-blocks). The MCP tool is deterministic — it does not invoke skills directly.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory.' },
          reason: { type: 'string', description: 'Optional reason override (manual / new-archetype / periodic / foundation-drift). Defaults to inferred.' },
        },
        required: ['outputDir'],
      },
    },
    {
      name: 'liberate_block_transform_apply',
      description: 'Apply composed block markup to a post in the running replica site. Validates: parse_blocks roundtrip + output-verify text-substring check + post-existence poll (3 retries with backoff). Idempotent via block-transform-log.jsonl (same source+output hashes skip re-apply). Studio path uses `wp post update` via studio CLI.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory (block-transform-log.jsonl lives here).' },
          url: { type: 'string', description: 'Source URL (post is matched via _source_url meta in the replica).' },
          blocks: { type: 'string', description: 'Composed block markup to apply as post_content.' },
          sourceHtml: { type: 'string', description: 'Original sanitized source HTML — passed to output-verify for text-substring validation.' },
          target: {
            type: 'object' as const,
            description: 'Replica site target. Studio: { kind: "studio", sitePath: "..." }.',
            properties: {
              kind: { type: 'string', enum: ['studio'] },
              sitePath: { type: 'string' },
              siteUrl: { type: 'string' },
            },
            required: ['kind'],
          },
          composedBy: { type: 'string', description: 'Provenance string for the log entry (e.g. "compose-page-blocks@v1.0" or "heuristic@v1.0").' },
        },
        required: ['outputDir', 'url', 'blocks', 'sourceHtml', 'target'],
      },
    },
    {
      name: 'liberate_block_compose',
      description: 'Validate composed block markup and write it to a sidecar file (<outputDir>/composed/<slug>.blocks.html) for the streaming watch loop to install as post_content. Compose-then-install counterpart to liberate_block_transform_apply: same parse_blocks roundtrip + output-verify validation, same block-transform-log.jsonl idempotency, but NO database write. The runner reads the sidecar after the agent returns and passes the contents to wp_insert_post via contentOverride, so the very first DB write of each post carries block markup (not raw HTML that gets transformed afterward). Use this in the streaming watch loop\'s compose-page-blocks judgment; reach for liberate_block_transform_apply only for re-composing already-imported posts.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory (sidecar lives at <outputDir>/composed/, log is block-transform-log.jsonl).' },
          url: { type: 'string', description: 'Source URL — used for log entries and as the manifest lookup key when sourceHtml is omitted.' },
          slug: { type: 'string', description: 'Post slug — determines the sidecar filename (composed/<slug>.blocks.html). Must match the WxrItem.slug the runner buffered.' },
          blocks: { type: 'string', description: 'Composed block markup. Validated for parse_blocks roundtrip and against sourceHtml for text-substring containment.' },
          sourceHtml: { type: 'string', description: 'Sanitized source HTML used for anti-hallucination output-verify. Optional — falls back to <outputDir>/screenshots/manifest.json lookup.' },
          composedBy: { type: 'string', description: 'Provenance string for the log entry (default "compose-page-blocks@v1.0").' },
          source: { type: 'string', enum: ['heuristic', 'ai'], description: 'Compose source flavour for the log entry (default "ai").' },
        },
        required: ['outputDir', 'url', 'slug', 'blocks'],
      },
    },
    {
      name: 'liberate_replicate_inventory',
      description:
        'Read a liberation outputDir and return a structured archetype inventory: counts per archetype (homepage/page/post/product/gallery/event), up to 3 representative URLs per archetype with their screenshot+html paths (selected by largest HTML — proxy for section count), product count from products.jsonl, and presence of design-foundation.json. Used by the replicate skill in Step 1 (Inventory). Throws when output.wxr is missing.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory (must contain output.wxr).' },
        },
        required: ['outputDir'],
      },
    },
    {
      name: 'liberate_replicate_verify',
      description:
        'Capture replica screenshots at given URLs (desktop + mobile by default) against a running replica WP install and pair each viewport with the matching source screenshot from screenshots/manifest.json. Returns a structured pairing manifest the calling agent (vision-capable) uses for side-by-side comparison. Used by the replicate skill in Step 6 (Verify). Replica screenshots are written to <outputDir>/<outputSubdir>/<viewport>/<slug>.png — same shape as the source layout.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory (contains screenshots/manifest.json and the source screenshots/).' },
          replicaBaseUrl: { type: 'string', description: 'Base URL of the running replica (e.g. https://my-site-replica.wp.local or http://localhost:8881). No trailing slash.' },
          urls: { type: 'array', items: { type: 'string' }, description: 'Path-only URLs to verify (e.g. ["/", "/blog/post-1"]).' },
          viewports: { type: 'array', items: { type: 'string', enum: ['desktop', 'mobile'] }, description: 'Viewports to capture. Default: ["desktop", "mobile"].' },
          outputSubdir: { type: 'string', description: 'Where in outputDir to write replica screenshots. Default: "replica-screenshots". Files land at <subdir>/<viewport>/<slug>.png.' },
          cdpPort: { type: 'number', description: 'Connect to existing Chrome via CDP (otherwise launches a new browser).' },
        },
        required: ['outputDir', 'replicaBaseUrl', 'urls'],
      },
    },
    {
      name: 'liberate_refine_report',
      description: 'Validate refine coverage for one page: reads <outputDir>/refine/<slug>/*.json (one file per section, written by match-section) and enforces that EVERY finding id appears in exactly one of applied[]/skipped[]. Fails loudly, naming unaccounted IDs. match-page must not mark a page done until this passes.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          outputDir: { type: 'string', description: 'Liberation output directory (contains refine/<slug>/ written by match-section).' },
          slug: { type: 'string', description: 'Page slug whose refine/<slug>/ directory to validate.' },
        },
        required: ['outputDir', 'slug'],
      },
    },
    {
      name: 'liberate_compare',
      description:
        'Pixel-parity scorer (fixed viewport). Joins an origin screenshots dir to a replica screenshots dir by URL pathname, crops both full-page PNGs to the top 1440×900 / 390×844 region, and returns per-pathname desktop/mobile similarity scores (1 − diffPixels/total). Writes comparison.json (v2 with originHeight/replicaHeight/heightMismatchRatio per viewport) + diff PNGs into the replica dir. Writes magenta-padded .padded.png diff when height mismatch exceeds 2%. Both dirs must have the standard layout: manifest.json + desktop/<slug>.png + mobile/<slug>.png.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          originDir: { type: 'string', description: 'Origin screenshots dir (manifest.json + desktop/ mobile/).' },
          replicaDir: { type: 'string', description: 'Replica screenshots dir, same layout. comparison.json + diff/ are written here.' },
          viewports: { type: 'array', items: { type: 'string', enum: ['desktop', 'mobile'] }, description: 'Viewports to score. Default: both.' },
          diffOutputDir: { type: 'string', description: 'Where to write diff PNGs. Default: <replicaDir>/diff.' },
          floor: { type: 'number', description: 'Pass/fail score floor used for repair-tasks.json records. Default 0.99.' },
          maxHeightDelta: { type: 'number', description: 'Height-gate tolerance in capture px (pre-crop |originH - replicaH|). Default 8.' },
        },
        required: ['originDir', 'replicaDir'],
      },
    },
    {
      name: 'liberate_ingest_local_site',
      description:
        'Stage 1a of the owned-source path: ingest a local static-site directory (HTML/CSS/JS) and normalize each page into validated native Gutenberg block markup. Writes <outputDir>/composed/<slug>.blocks.html sidecars + <outputDir>/normalize-report.json. No Playwright/Studio. Downstream theme-scaffold/install/compare stages consume the sidecars.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          dir: { type: 'string', description: 'Absolute path to the local static-site directory to ingest.' },
          outputDir: { type: 'string', description: 'Liberation output directory for composed sidecars + normalize-report.json. Defaults to `dir`.' },
          nativeBehaviors: { type: 'boolean', description: 'Detect catalog behaviors in the source css/js and emit dla/* Interactivity wrappers in the sidecars instead of core/group: uniform dla/reveal plus per-section DOM patterns (dla/tabs, dla/slider, dla/modal — verbatim inner markup). liberate_convert_local_site threads its own flag through here.' },
        },
        required: ['dir'],
      },
    },
    {
      name: 'liberate_convert_local_site',
      description:
        'Stage 1b+1c of the owned-source path: full local-static-site → live Studio site. Reuses liberate_ingest_local_site (sidecars + normalize-report), optionally captures the source design (palette/typography/screenshots) and self-hosts Google Fonts, assembles the local block theme (core/navigation header from the nav graph, foundation-styled footer, no-title page templates), writes + activates it, creates WP Pages from the sidecars (idempotent via _source_url), sets the front page, assigns the page-local template, and optionally captures the WP replica + scores parity.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          dir: { type: 'string', description: 'Absolute path to the local static-site directory.' },
          studioSitePath: { type: 'string', description: 'Studio site path on host (e.g. ~/Studio/my-site — the dir studio site list prints, not wp-root).' },
          createSite: { type: 'boolean', description: 'Provision the Studio site via `studio site create` when none exists at studioSitePath (idempotent — an existing site is reused). Default false (errors if the site is absent). Admin creds via env WP_ADMIN_USER/WP_ADMIN_PASS; omitted → Studio auto-generates.' },
          outputDir: { type: 'string', description: 'Liberation output dir for sidecars + reports. Defaults to `dir`.' },
          themeSlug: { type: 'string', description: 'Theme slug (kebab-case). Default: local-site-theme.' },
          siteTitle: { type: 'string', description: 'Site title for header/footer. Default: home page <title>.' },
          skipDesign: { type: 'boolean', description: 'Skip source design capture (tokens/fonts) and compare; theme uses default styling.' },
          skipCompare: { type: 'boolean', description: 'Skip the WP-replica screenshot + parity compare stage.' },
          wpUrl: { type: 'string', description: 'Base URL for replica capture. Default: auto-resolved via wp option get siteurl (Studio assigns random ports); explicit value overrides.' },
          carryCss: { type: 'boolean', description: 'Carry the source stylesheet into the theme (adapted for the block DOM). Default true — the stage-1d parity mechanism; tokens-only theming when false.' },
          carryJs: { type: 'boolean', description: 'Carry the source scripts into the theme (enqueued footer, html.js gate added). Default true for identical replication.' },
          nativeBehaviors: { type: 'boolean', description: 'Replace carried source JS with native Interactivity blocks (reveal, sticky, plus per-section tabs/slider/modal with verbatim inner markup); unmapped behaviors land in behavior-gaps.json. Forces carryJs off.' },
          editableIslands: { type: 'boolean', description: 'Convert carried core/html islands into editable dla/editable-html blocks (text+image bindable, static-save, render-anywhere). Default true; set false to force plain core/html.' },
          dataModel: { type: 'boolean', description: 'WordPress-driven data path: when a data-model.json (from the model-local-data skill) is present in outputDir/dir, register a CPT+taxonomy via generated mu-plugins, insert items idempotently, and replace empty JS-mount grids with native core/query loops (dla/data-card cards) while neutralizing the JS data-mounts and rebinding modal lookups to per-card DOM islands. Default on when the file exists; pass false to force off.' },
          repair: { type: 'boolean', description: 'Deterministic parity repair loop: diff regions → computed-style probe → generated parity-patch.css → re-compare, bounded. Default true. No AI involved.' },
          maxRepairRounds: { type: 'number', description: 'Max repair rounds (0-5). Default 2. Loop also stops early on allPass or an unchanged divergence fingerprint.' },
          failOnConservationRailDrop: { type: 'boolean', description: 'Opt-in hard fail for local region-audit conservation: when true, unassigned nav/complementary rails with at least two links set isError. Default false (warn-only).' },
        },
        required: ['dir', 'studioSitePath'],
      },
    },
    ...(JSON.parse(JSON.stringify(
      Object.entries(NEW_TOOL_SCHEMAS).map(([name, def]) => ({ name, ...def })),
    )) as Array<{ name: string; description: string; inputSchema: { type: 'object'; [k: string]: unknown } }>),
  ],
}));

/** Tool name → handler module. */
const handlers: Record<string, Handler> = {
  liberate_compare: compareHandler,
  liberate_data_model_scaffold: dataModelScaffoldHandler,
  liberate_design_foundation_save: designFoundationSaveHandler,
  liberate_design_foundation_scaffold: designFoundationScaffoldHandler,
  liberate_design_foundation_validate: designFoundationValidateHandler,
  liberate_detect: detectHandler,
  liberate_discover: discoverHandler,
  liberate_block_transform_apply: blockTransformApplyHandler,
  liberate_block_compose: blockComposeHandler,
  liberate_extract: extractHandler,
  liberate_extract_one: extractOneHandler,
  liberate_media_install: mediaInstallHandler,
  liberate_replicate_tick: replicateTickHandler,
  liberate_import: wpImportHandler,
  liberate_inspect: inspectHandler,
  liberate_map_apis: mapApisHandler,
  liberate_preview: previewHandler,
  liberate_install_theme: installThemeHandler,
  liberate_theme_scaffold: themeScaffoldHandler,
  liberate_probe: probeHandler,
  liberate_qa: qaHandler,
  liberate_replicate_inventory: replicateInventoryHandler,
  liberate_replicate_verify: replicateVerifyHandler,
  liberate_refine_report: refineReportHandler,
  liberate_screenshot: screenshotHandler,
  liberate_setup: setupHandler,
  liberate_paths: pathsHandler,
  liberate_status: statusHandler,
  liberate_verify: verifyHandler,
  liberate_cluster_pages: clusterPagesHandler,
  liberate_section_extract: sectionExtractHandler,
  liberate_compose_instantiate: composeInstantiateHandler,
  liberate_ingest_local_site: ingestLocalSiteHandler,
  liberate_convert_local_site: convertLocalSiteHandler,
  liberate_validate_artifacts: validateArtifactsHandler,
  liberate_reconstruct_pages: reconstructPagesHandler,
  liberate_reconstruct_pages_carry: reconstructPagesCarryHandler,
  liberate_blockify_wxr: blockifyWxrHandler,
};

function makeContext(): HandlerContext {
  return { adapters, findAdapter, textResult, errorResult, server };
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];
  if (!handler) return errorResult(`Unknown tool: ${name}`);
  return handler((args ?? {}) as Record<string, unknown>, makeContext());
});


async function main() {
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
