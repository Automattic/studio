import * as cheerio from 'cheerio';
import { classifyUrl } from './extraction/sitemap.js';
import { parseSitemapDocument } from './extraction/sitemap.js';
import { extractNavLinks } from './html-extract/index.js';
import { safeFetch } from './media-fetch/safe-fetch.js';
import { detectFromDocument } from './detect-platform/index.js';

export const INSPECTION_SCHEMA_VERSION = '1.0';

const DEFAULT_DISCOVERY_LIMIT = 50;
const DEFAULT_SAMPLE_LIMIT = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 30_000;

export interface InspectOptions {
  discoveryLimit?: number;
  sampleLimit?: number;
  requestTimeoutMs?: number;
  overallTimeoutMs?: number;
  log?: (message: string) => void;
}

export interface InspectionIssue {
  code: string;
  message: string;
  url?: string;
}

export interface SourceInspection {
  schemaVersion: typeof INSPECTION_SCHEMA_VERSION;
  source: {
    requestedUrl: string;
    finalUrl: string;
    platform: { id: string; confidence: 'high' | 'medium' | 'low'; evidence: string[] };
  };
  coverage: {
    discovery: { routes: number; limit: number; truncated: boolean };
    sampling: { routes: number; attempted: number; succeeded: number; failed: number; limit: number; truncated: boolean; complete: boolean };
  };
  routes: { types: Record<string, number> };
  samples: Array<{
    url: string;
    type: string;
    status: number;
    contentType: string | null;
    outcome: 'html' | 'http-error' | 'non-html';
    observations: {
      title: string | null;
      html: boolean;
      forms: number | null;
      links: number | null;
      images: number | null;
      scripts: number | null;
      stylesheets: number | null;
      externalResourceOrigins: string[] | null;
    };
  }>;
  unknowns: string[];
  issues: InspectionIssue[];
  timing: { durationMs: number };
}

export class InspectError extends Error {}

interface Route { url: string; type: string }

function boundedInteger(value: number | undefined, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new InspectError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function routeKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.href;
}

function isHtml(contentType: string | null): boolean {
  return contentType?.split(';', 1)[0].trim().toLowerCase() === 'text/html'
    || contentType?.split(';', 1)[0].trim().toLowerCase() === 'application/xhtml+xml';
}

function unknownObservations() {
  return { title: null, html: false, forms: null, links: null, images: null, scripts: null, stylesheets: null, externalResourceOrigins: null };
}

function observe(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const origins = new Set<string>();
  const origin = new URL(baseUrl).origin;
  const addResource = (rawUrl: string | undefined) => {
    if (!rawUrl) return;
    try {
      const resource = new URL(rawUrl, baseUrl);
      if ((resource.protocol === 'http:' || resource.protocol === 'https:') && resource.origin !== origin) origins.add(resource.origin);
    } catch { /* malformed authored URL */ }
  };
  $('img[src], script[src], link[rel~="stylesheet"][href], source[src], video[src], video[poster], audio[src], iframe[src], embed[src], object[data]').each((_, element) => {
    addResource($(element).attr('src') ?? $(element).attr('href') ?? $(element).attr('poster') ?? $(element).attr('data'));
  });
  $('img[srcset], source[srcset]').each((_, element) => {
    for (const candidate of ($(element).attr('srcset') ?? '').split(',')) addResource(candidate.trim().split(/\s+/, 1)[0]);
  });
  return {
    title: $('title').first().text().trim() || null,
    html: true,
    forms: $('form').length,
    links: $('a').length,
    images: $('img').length,
    scripts: $('script').length,
    stylesheets: $('link[rel~="stylesheet"]').length,
    externalResourceOrigins: [...origins].sort(),
  };
}

export async function inspectSource(url: string, options: InspectOptions = {}): Promise<SourceInspection> {
  const discoveryLimit = boundedInteger(options.discoveryLimit, 'discoveryLimit', DEFAULT_DISCOVERY_LIMIT, 1, 100);
  const sampleLimit = boundedInteger(options.sampleLimit, 'sampleLimit', DEFAULT_SAMPLE_LIMIT, 1, 10);
  const requestTimeoutMs = boundedInteger(options.requestTimeoutMs, 'requestTimeoutMs', DEFAULT_REQUEST_TIMEOUT_MS, 1_000, 30_000);
  const overallTimeoutMs = boundedInteger(options.overallTimeoutMs, 'overallTimeoutMs', DEFAULT_OVERALL_TIMEOUT_MS, 1_000, 60_000);
  const started = Date.now();
  const deadline = AbortSignal.timeout(overallTimeoutMs);
  const issues: InspectionIssue[] = [];
  const fetchBounded = async (requestUrl: string) => {
    if (deadline.aborted) throw new InspectError(`inspection exceeded overallTimeoutMs (${overallTimeoutMs})`);
    return safeFetch(requestUrl, { timeoutMs: requestTimeoutMs, maxBytes: 2 * 1024 * 1024, signal: deadline });
  };

  options.log?.('Inspecting entry route');
  const entry = await fetchBounded(url);
  const entryHtml = entry.body.toString('utf8');
  const finalUrl = entry.finalUrl;
  const origin = new URL(finalUrl).origin;
  const routes: Route[] = [{ url: finalUrl, type: 'homepage' }];
  const seen = new Set([routeKey(finalUrl)]);
  let discoveryTruncated = false;

  const addRoute = (rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl, finalUrl);
      if (parsed.origin !== origin) return;
      const key = routeKey(parsed.href);
      if (seen.has(key)) return;
      if (routes.length >= discoveryLimit) { discoveryTruncated = true; return; }
      seen.add(key);
      routes.push({ url: key, type: classifyUrl(key) });
    } catch { /* ignore malformed discovery URL */ }
  };

  options.log?.('Discovering a bounded route inventory');
  try {
    const sitemap = await fetchBounded(new URL('/sitemap.xml', origin).href);
    if (sitemap.status >= 200 && sitemap.status < 300) {
      const document = parseSitemapDocument(sitemap.body.toString('utf8'));
      if (document.kind === 'index') {
        discoveryTruncated = true;
        issues.push({ code: 'nested-sitemap-unvisited', message: `Sitemap index contains ${document.locs.length} child sitemap URL(s); nested sitemaps are outside this inspection bound.`, url: sitemap.finalUrl });
      } else {
        for (const sitemapUrl of document.locs) addRoute(sitemapUrl);
      }
    } else {
      issues.push({ code: 'sitemap-unavailable', message: `Sitemap returned HTTP ${sitemap.status}`, url: sitemap.finalUrl });
    }
  } catch (error) {
    issues.push({ code: 'sitemap-unavailable', message: error instanceof Error ? error.message : String(error) });
  }
  for (const link of extractNavLinks(entryHtml, finalUrl)) addRoute(link.href);

  const selected: Route[] = [];
  const selectedKeys = new Set<string>();
  for (const route of routes) {
    if (selected.length >= sampleLimit) break;
    if (route.type === 'homepage' || !selected.some((sample) => sample.type === route.type)) {
      selected.push(route);
      selectedKeys.add(route.url);
    }
  }
  for (const route of routes) {
    if (selected.length >= sampleLimit) break;
    if (!selectedKeys.has(route.url)) selected.push(route);
  }

  const samples: SourceInspection['samples'] = [];
  let failedSamples = 0;
  for (const route of selected) {
    try {
      const response = route.url === finalUrl ? entry : await fetchBounded(route.url);
      const contentType = response.headers.get('content-type');
      const successful = response.status >= 200 && response.status < 300;
      const html = successful && isHtml(contentType);
      const outcome = !successful ? 'http-error' : html ? 'html' : 'non-html';
      samples.push({
        url: response.finalUrl,
        type: route.type,
        status: response.status,
        contentType,
        outcome,
        observations: html ? observe(response.body.toString('utf8'), response.finalUrl) : unknownObservations(),
      });
      if (!successful) issues.push({ code: 'sample-http-status', message: `Sample returned HTTP ${response.status}`, url: response.finalUrl });
      if (outcome === 'non-html') issues.push({ code: 'sample-non-html', message: `Sample content type ${contentType ?? 'unknown'} was not HTML`, url: response.finalUrl });
    } catch (error) {
      failedSamples++;
      issues.push({ code: 'sample-failed', message: error instanceof Error ? error.message : String(error), url: route.url });
    }
  }
  const types: Record<string, number> = {};
  for (const route of routes) types[route.type] = (types[route.type] ?? 0) + 1;
  const samplingTruncated = routes.length > selected.length;
  const detection = detectFromDocument(finalUrl, entry.headers, isHtml(entry.headers.get('content-type')) ? entryHtml : '');
  return {
    schemaVersion: INSPECTION_SCHEMA_VERSION,
    source: { requestedUrl: url, finalUrl, platform: { id: detection.platform, confidence: detection.confidence, evidence: detection.signals } },
    coverage: {
      discovery: { routes: routes.length, limit: discoveryLimit, truncated: discoveryTruncated },
      sampling: { routes: samples.length, attempted: selected.length, succeeded: samples.length, failed: failedSamples, limit: sampleLimit, truncated: samplingTruncated, complete: !samplingTruncated && failedSamples === 0 },
    },
    routes: { types },
    samples,
    unknowns: [
      'Rendered layout and responsive reflow were not measured; inspection does not run the full browser capture pipeline.',
      'Interactive behavior was not activated; forms and links are counted from source HTML only.',
      'Discovery is limited to the entry navigation and one sitemap document; platform-specific and nested discovery were not run.',
    ],
    issues,
    timing: { durationMs: Date.now() - started },
  };
}
