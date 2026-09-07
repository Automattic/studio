// src/lib/detect-platform/detect-platform.ts
//
// The automatic-detection ENGINE. Platforms own their signals (declared on the
// Platform contract and carried in the platform registry); this module only
// implements the tiered matching order and never hardcodes a platform:
//
//   1. URL patterns   — tested against the site URL before any fetch (high).
//   2. HTTP headers   — response-header fingerprints (high).
//   3. Page source    — HTML markers, only when no header matched (medium).
//   4. Path probes    — same-origin HEAD probes, only when all else failed
//                       (high; extra HTTP round-trip, so strictly last).
//
// Platforms are consulted in registration order; when several signals match,
// every matching signal is recorded and the last matching platform wins
// (built-in signals fingerprint disjoint infrastructure, so in practice only
// consumer-registered platforms can collide — deterministically).
import { registeredPlatforms } from '../../platform/registry.js';
import type {
	Platform,
	PlatformHttpSignal,
	PlatformPathProbe,
	PlatformSourceSignal,
} from '../../platform/types.js';
// Ensure the built-in platforms are registered before any detection query.
// (Third-party platforms registered later simply join the same registry.)
import '../../platform/builtins.js';

export interface DetectionResult {
  platform: string;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
}

export interface FullDetectionResult extends DetectionResult {
  url: string;
}

export function detectFromUrl(url: string): string | null {
  const normalized = url.includes('://') ? url : `https://${url}`;
  for (const platform of registeredPlatforms()) {
    for (const pattern of platform.detection?.urlPatterns ?? []) {
      if (pattern.test(normalized)) return platform.id;
    }
  }
  return null;
}

function matchHttpSignals(
  platforms: Platform[],
  headers: Headers,
): { platform: string | null; signals: string[] } {
  let matched: string | null = null;
  const signals: string[] = [];
  for (const platform of platforms) {
    for (const sig of platform.detection?.httpSignals ?? []) {
      const headerVal = headers.get(sig.header);
      if (headerVal && (!sig.value || headerVal.toLowerCase().includes(sig.value.toLowerCase()))) {
        matched = platform.id;
        signals.push(sig.signal);
      }
    }
  }
  return { platform: matched, signals };
}

function matchSourceSignals(
  platforms: Platform[],
  html: string,
): { platform: string | null; signals: string[] } {
  let matched: string | null = null;
  const signals: string[] = [];
  for (const platform of platforms) {
    for (const sig of platform.detection?.sourceSignals ?? []) {
      if (sig.pattern.test(html)) {
        matched = platform.id;
        signals.push(sig.signal);
      }
    }
  }
  return { platform: matched, signals };
}

async function matchPathProbes(
  platforms: Platform[],
  normalizedUrl: string,
): Promise<{ platform: string | null; signal: string | null }> {
  for (const platform of platforms) {
    for (const probe of platform.detection?.pathProbes ?? []) {
      try {
        const probeUrlObj = new URL(probe.path, normalizedUrl);
        if (probeUrlObj.origin !== new URL(normalizedUrl).origin) continue;
        const probeUrl = probeUrlObj.toString();
        const probeResp = await fetch(probeUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(10000),
          redirect: 'manual',
        });
        if (!probe.expectedStatus.includes(probeResp.status)) continue;
        if (probe.locationContains) {
          const loc = probeResp.headers.get('location') || '';
          if (!loc.includes(probe.locationContains)) continue;
        }
        return { platform: platform.id, signal: probe.signal };
      } catch {
        // Probe fetch failed (network error, timeout, etc.) — try next probe.
      }
    }
  }
  return { platform: null, signal: null };
}

export async function detectFromHttp(url: string): Promise<DetectionResult> {
  const signals: string[] = [];
  let platform = 'unknown';
  let confidence: 'high' | 'medium' | 'low' = 'low';
  const platforms = registeredPlatforms();

  try {
    const normalized = url.includes('://') ? url : `https://${url}`;
    const response = await fetch(normalized, {
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });

    const headerMatch = matchHttpSignals(platforms, response.headers);
    if (headerMatch.platform) {
      platform = headerMatch.platform;
      confidence = 'high';
      signals.push(...headerMatch.signals);
    }

    if (platform === 'unknown') {
      let html = '';
      try {
        html = await response.text();
      } catch {
        // Body read failed (truncation, encoding, mid-stream network error).
        // Fall through to source-pattern (no matches) and probe tier.
      }
      const sourceMatch = matchSourceSignals(platforms, html);
      if (sourceMatch.platform) {
        platform = sourceMatch.platform;
        confidence = 'medium';
        signals.push(...sourceMatch.signals);
      }
    }

    if (platform === 'unknown') {
      const probeMatch = await matchPathProbes(platforms, normalized);
      if (probeMatch.platform) {
        platform = probeMatch.platform;
        confidence = 'high';
        signals.push(probeMatch.signal!);
      }
    }
  } catch {
    // Network error — return unknown
  }

  return { platform, confidence, signals };
}

export async function detect(url: string): Promise<FullDetectionResult> {
  const urlResult = detectFromUrl(url);
  if (urlResult) {
    return {
      url,
      platform: urlResult,
      confidence: 'high',
      signals: [`URL contains ${urlResult} domain`],
    };
  }

  const httpResult = await detectFromHttp(url);
  return { url, ...httpResult };
}

// Re-exported for consumers that want to type custom signals against the
// engine's contract (the shapes live with the public Platform contract).
export type { PlatformHttpSignal, PlatformPathProbe, PlatformSourceSignal };
