// src/lib/screenshot/js-aggregator.ts
//
// First-party-only JS filter for --include-scripts (security-gated):
//   keep  if (first-party OR allowlisted library CDN) AND not a tracker
//   drop  all other third-party, and any tracker-pattern script (even 1st-party)
//
import { isFirstParty } from './first-party.js';

export const LIBRARY_CDN_ALLOWLIST = [
  'code.jquery.com', 'ajax.googleapis.com', 'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net', 'unpkg.com', 'cdn.bootstrapcdn.com',
  'stackpath.bootstrapcdn.com', 'kit.fontawesome.com', 'use.fontawesome.com',
];
// polyfill.io deliberately excluded (2024 supply-chain compromise).
const DENY_HOSTS = ['polyfill.io'];
const TRACKER_PATTERNS = [
  // Google
  /gtag\s*\(/, /dataLayer/, /\bga\s*\(/, /google-analytics/, /googletagmanager/,
  // Meta / Facebook
  /fbq\s*\(/,
  // HubSpot
  /_hsq/,
  // generic analytics SDKs (Segment, etc.)
  /analytics\.(track|page|load|identify)\s*\(/,
  // Hotjar
  /\bhj\s*\(/, /_hjSettings/,
  // Heap
  /heap\.(load|track)\s*\(/,
  // Intercom
  /\bIntercom\s*\(/, /intercomSettings/,
  // Microsoft Clarity
  /\bclarity\s*\(/,
  // TikTok pixel
  /\bttq\./,
  // LinkedIn
  /_linkedin_partner_id/, /\blintrk\s*\(/,
  // Snap / Pinterest / Twitter(X) pixels
  /\bsnaptr\s*\(/, /\bpintrk\s*\(/, /\btwq\s*\(/,
];

export function isTrackerScript(code: string): boolean {
  return TRACKER_PATTERNS.some((re) => re.test(code));
}
export function isAllowlistedCdn(url: string): boolean {
  let host: string;
  try { host = new URL(url).hostname; } catch { return false; }
  if (DENY_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  return LIBRARY_CDN_ALLOWLIST.some((a) => host === a || host.endsWith(`.${a}`));
}

export interface ScriptInput { src?: string; content: string }

export class JsAggregator {
  private parts: string[] = [];
  private chain: Promise<void> = Promise.resolve();
  constructor(private baseUrl: string) {}

  add(_slug: string, scripts: ScriptInput[]): Promise<void> {
    this.chain = this.chain.then(() => {
      for (const s of scripts) {
        if (isTrackerScript(s.content)) continue;
        if (s.src && !(isFirstParty(s.src, this.baseUrl) || isAllowlistedCdn(s.src))) continue;
        if (s.content.trim()) this.parts.push(s.content);
      }
    });
    return this.chain;
  }
  toString(): string { return this.parts.join('\n;\n'); }
}
