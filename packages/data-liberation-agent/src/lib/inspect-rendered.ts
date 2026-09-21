import type { Browser, Page } from 'playwright';
import { desktopContextOptions, sourceSessionCookieHeader } from './browser-kit/browser-kit.js';
import { safeFetch, assertPublicHttpUrl } from './media-fetch/safe-fetch.js';

/**
 * The capability vocabulary is a public contract, not an implementation
 * detail. A destination publishes coverage against these names, and a caller
 * joins the two to decide whether a source can land there. Members may be
 * added under a new vocabulary version; removing or repurposing one is a
 * breaking change, because someone's acceptance policy is keyed on it.
 */
export const SOURCE_CAPABILITY_VOCABULARY = 'data-liberation/source-capability-vocabulary/v1';
export const SOURCE_CAPABILITIES = ['booking', 'commerce', 'dialogs', 'embeds', 'forms', 'media', 'membership', 'navigation'] as const;
/**
 * HTML document ceiling for inspect. Page-builder homepages routinely exceed
 * 2 MB (a 2.9 MB Wix events page was rejected before any detector ran). 10 MB
 * sits above observed documents and below the 25 MB process-wide download cap.
 */
export const INSPECT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Per-asset ceiling inside a rendered inspect sample. */
export const INSPECT_ASSET_MAX_BYTES = 2 * 1024 * 1024;
export type SourceCapability = (typeof SOURCE_CAPABILITIES)[number];
/** One host-injected surface to attribute away from the source. */
export interface HostResidue { host: string; selector: string; evidence: string }
export interface CapabilityRule {
  capability: SourceCapability;
  selector: string;
  evidence: string;
}
/** A surface attributed to the deployment host rather than to the source. */
export interface ExcludedSurface {
  host: string;
  selector: string;
  evidence: string;
  matched: number;
  elements: number;
}

export interface RenderedInspection {
  url: string;
  elements: number;
  textCharacters: number;
  counts: Record<'forms' | 'links' | 'images' | 'videos' | 'frames' | 'dialogs', number>;
  /**
   * Each finding carries the route it was observed on (this sample's `url`),
   * the selector that matched it, and bounded locators for the matches, so a
   * consumer can act on an occurrence instead of only on a site-wide band.
   */
  capabilities: Array<{ capability: SourceCapability; count: number; evidence: string; selector: string; locators: string[] }>;
  /** Host-injected surfaces, reported rather than silently dropped. */
  excluded: ExcludedSurface[];
  navigation: string[];
  requests: number;
  bytes: number;
  limited: boolean;
  unknowns: string[];
}

const GENERIC_RULES: CapabilityRule[] = [
  { capability: 'forms', selector: 'form', evidence: 'Rendered form; submission was not exercised' },
  { capability: 'navigation', selector: 'nav,[role="navigation"]', evidence: 'Rendered navigation landmark' },
  { capability: 'media', selector: 'video,audio,canvas', evidence: 'Media or canvas surface requires behavioral review' },
  { capability: 'embeds', selector: 'iframe,object,embed', evidence: 'Embedded surface; inner application behavior is unknown' },
  { capability: 'dialogs', selector: 'dialog,[role="dialog"],[aria-haspopup],[aria-expanded],details', evidence: 'Interactive disclosure or popup affordance' },
  { capability: 'membership', selector: 'input[type="password"],a[href*="/login"],a[href*="/sign-in"]', evidence: 'Authentication affordance; backend behavior is unknown' },
  { capability: 'commerce', selector: '[itemtype*="schema.org/Product"],a[href*="/checkout"],form[action*="/cart"]', evidence: 'Product or checkout surface; transactions were not exercised' },
];

/** A bounded browser reader. Every network response is fetched through the same
 * size/redirect guard as HTTP inspection, including script-initiated requests.
 * POSTs and service workers are blocked; inspection never activates controls. */
export async function createRenderedInspector(signal: AbortSignal, requestTimeoutMs: number) {
  signal.throwIfAborted();
  const { chromium } = await import('playwright');
  let browser: Browser | undefined;
  const close = async () => { await browser?.close(); };
  const abort = () => { void close().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    browser = await chromium.launch({ timeout: Math.min(requestTimeoutMs, 10_000) });
    signal.throwIfAborted();
  } catch (error) {
    signal.removeEventListener('abort', abort);
    await close();
    throw error;
  }
  return {
    async inspect(url: string, rules: CapabilityRule[] = [], residue: HostResidue[] = []): Promise<RenderedInspection> {
      signal.throwIfAborted();
      assertPublicHttpUrl(url);
      const context = await browser!.newContext({
        ...(await desktopContextOptions(browser!)),
        serviceWorkers: 'block',
        viewport: { width: 1440, height: 900 },
      });
      const page: Page = await context.newPage();
      let requests = 0;
      let bytes = 0;
      let limited = false;
      const unknowns = new Set<string>();
      const sampleSignal = AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]);
      const abortSample = () => { void context.close().catch(() => undefined); };
      sampleSignal.addEventListener('abort', abortSample, { once: true });
      try {
        await context.route('**/*', async (route) => {
          const request = route.request();
          try {
            if (request.method() !== 'GET') throw new Error('Non-GET requests were blocked');
            if (++requests > 100 || bytes >= 10 * 1024 * 1024) {
              limited = true;
              throw new Error('Rendered resource budget reached');
            }
            const response = await safeFetch(request.url(), {
              timeoutMs: requestTimeoutMs,
              maxBytes: Math.min(
                request.isNavigationRequest() ? INSPECT_DOCUMENT_MAX_BYTES : INSPECT_ASSET_MAX_BYTES,
                10 * 1024 * 1024 - bytes
              ),
              signal: sampleSignal,
              // Every request this page makes is actually fetched here, not by
              // the browser — so a source gated behind an entry-URL session
              // needs its cookie forwarded per request, scoped to that
              // request's own origin so it can't follow a cross-origin redirect.
              headersForOrigin: async (origin) => {
                const cookie = await sourceSessionCookieHeader(origin);
                return cookie ? { cookie } : undefined;
              },
            });
            bytes += response.body.length;
            if (bytes > 10 * 1024 * 1024) { limited = true; throw new Error('Rendered byte budget reached'); }
            // Redirects are resolved by safeFetch; document origin must remain the
            // inspected origin, rather than executing a different origin in it.
            if (request.isNavigationRequest() && response.finalUrl !== request.url()) {
              throw new Error('Rendered navigation redirect requires separate inspection');
            }
            const headers = Object.fromEntries(response.headers);
            delete headers['content-encoding'];
            delete headers['content-length'];
            await route.fulfill({ status: response.status, headers, body: response.body });
          } catch (error) {
            if (unknowns.size < 12) unknowns.add(error instanceof Error ? error.message.slice(0, 200) : 'Resource unavailable');
            await route.abort().catch(() => undefined);
          }
        });
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: requestTimeoutMs });
        if (!response?.ok()) throw new Error(`Rendered entry returned HTTP ${response?.status() ?? 'unknown'}`);
        await page.waitForTimeout(300);
        const observed = await page.evaluate(({ rules, residue }) => {
          // Surfaces the deployment host injected are facts about the host.
          // They are subtracted from what the source is said to contain, and
          // reported, so an exclusion is auditable rather than invisible.
          const injected = new Set<Element>();
          const excluded = residue.map((rule) => {
            const roots = [...document.querySelectorAll(rule.selector)];
            for (const root of roots) {
              injected.add(root);
              for (const node of root.querySelectorAll('*')) injected.add(node);
            }
            return { host: rule.host, selector: rule.selector, evidence: rule.evidence, matched: roots.length, elements: roots.reduce((total, root) => total + 1 + root.querySelectorAll('*').length, 0) };
          });
          const authored = [...document.querySelectorAll('*')].filter((element) => !injected.has(element));
          const counts = {
            forms: authored.filter((element) => element.matches('form')).length,
            links: authored.filter((element) => element.matches('a[href]')).length,
            images: authored.filter((element) => element.matches('img')).length,
            videos: authored.filter((element) => element.matches('video,audio,canvas')).length,
            frames: authored.filter((element) => element.matches('iframe,object,embed')).length,
            dialogs: authored.filter((element) => element.matches('dialog,[role="dialog"],[aria-haspopup],[aria-expanded],details')).length,
          };
          const capabilities = rules.flatMap((rule) => {
            const matches = authored.filter((element) => element.matches(rule.selector));
            const locators = matches.slice(0, 5).map((element) => {
              const id = element.id ? `#${element.id}` : '';
              const classes = (element.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 3).map((name) => `.${name}`).join('');
              return `${element.tagName.toLowerCase()}${id}${classes}`.slice(0, 120);
            });
            return matches.length ? [{ capability: rule.capability, count: matches.length, evidence: rule.evidence, selector: rule.selector, locators }] : [];
          });
          const navigation = authored.filter((element) => element.matches('a[href]'))
            .map((a) => (a as HTMLAnchorElement).href).filter((href) => {
              try { return new URL(href).origin === location.origin; } catch { return false; }
            });
          return { url: location.href, elements: authored.length,
            textCharacters: (document.body?.innerText ?? '').trim().length, counts, capabilities,
            excluded: excluded.filter((rule) => rule.matched > 0),
            navigation: [...new Set(navigation)].slice(0, 100), navigationLimited: navigation.length > 100 };
        }, { rules: [...GENERIC_RULES, ...rules].slice(0, 64), residue: residue.slice(0, 64) });
        sampleSignal.throwIfAborted();
        if (observed.navigationLimited) unknowns.add('Rendered navigation inventory reached 100 links');
        return { ...observed, requests, bytes, limited: limited || observed.navigationLimited, unknowns: [...unknowns] };
      } finally {
        sampleSignal.removeEventListener('abort', abortSample);
        await context.close();
      }
    },
    async close() { signal.removeEventListener('abort', abort); await close(); },
  };
}

export interface SourceComplexity {
  band: 'simple' | 'moderate' | 'complex' | 'unknown';
  observedBand: 'simple' | 'moderate' | 'complex' | 'unknown';
  confidence: 'bounded-sample' | 'incomplete';
  factors: Array<{ code: string; value: number; reason: string }>;
}

export function sourceComplexity(samples: RenderedInspection[], incomplete: boolean): SourceComplexity {
  const factors: SourceComplexity['factors'] = [];
  const maxElements = Math.max(0, ...samples.map((sample) => sample.elements));
  const capabilityCounts = new Map<SourceCapability, number>();
  for (const sample of samples) for (const finding of sample.capabilities) {
    capabilityCounts.set(finding.capability, Math.max(capabilityCounts.get(finding.capability) ?? 0, finding.count));
  }
  for (const [code, value] of capabilityCounts) {
    if (code !== 'navigation') factors.push({ code, value, reason: `Maximum observed ${code} matches on one sampled route` });
  }
  factors.push({ code: 'elements', value: maxElements, reason: 'Maximum rendered DOM element count on a sampled route' });
  const app = ['booking', 'commerce', 'membership'].some((key) => capabilityCounts.has(key as SourceCapability));
  const observedBand = !samples.length ? 'unknown' : app || maxElements > 2000 ? 'complex'
    : factors.some((factor) => factor.code !== 'elements') || maxElements > 500 ? 'moderate' : 'simple';
  const uncertain = incomplete || samples.some((sample) => sample.limited || sample.unknowns.length > 0);
  return { band: uncertain ? 'unknown' : observedBand, observedBand,
    confidence: uncertain ? 'incomplete' : 'bounded-sample', factors };
}
