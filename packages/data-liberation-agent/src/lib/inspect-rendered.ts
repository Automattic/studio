import type { Browser, Page } from 'playwright';
import { safeFetch, assertPublicHttpUrl } from './media-fetch/safe-fetch.js';

export type SourceCapability = 'forms' | 'navigation' | 'media' | 'embeds' | 'dialogs' | 'booking' | 'commerce' | 'membership';
export interface CapabilityRule {
  capability: SourceCapability;
  selector: string;
  evidence: string;
}
export interface RenderedInspection {
  url: string;
  elements: number;
  textCharacters: number;
  counts: Record<'forms' | 'links' | 'images' | 'videos' | 'frames' | 'dialogs', number>;
  capabilities: Array<{ capability: SourceCapability; count: number; evidence: string }>;
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
    async inspect(url: string, rules: CapabilityRule[] = []): Promise<RenderedInspection> {
      signal.throwIfAborted();
      assertPublicHttpUrl(url);
      const context = await browser!.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
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
              timeoutMs: requestTimeoutMs, maxBytes: Math.min(2 * 1024 * 1024, 10 * 1024 * 1024 - bytes), signal: sampleSignal,
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
        const observed = await page.evaluate((rules) => {
          const counts = {
            forms: document.querySelectorAll('form').length,
            links: document.querySelectorAll('a[href]').length,
            images: document.querySelectorAll('img').length,
            videos: document.querySelectorAll('video,audio,canvas').length,
            frames: document.querySelectorAll('iframe,object,embed').length,
            dialogs: document.querySelectorAll('dialog,[role="dialog"],[aria-haspopup],[aria-expanded],details').length,
          };
          const capabilities = rules.flatMap((rule) => {
            const count = document.querySelectorAll(rule.selector).length;
            return count ? [{ capability: rule.capability, count, evidence: rule.evidence }] : [];
          });
          const navigation = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
            .map((a) => a.href).filter((href) => {
              try { return new URL(href).origin === location.origin; } catch { return false; }
            });
          return { url: location.href, elements: document.querySelectorAll('*').length,
            textCharacters: (document.body?.innerText ?? '').trim().length, counts, capabilities,
            navigation: [...new Set(navigation)].slice(0, 100), navigationLimited: navigation.length > 100 };
        }, [...GENERIC_RULES, ...rules].slice(0, 64));
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
