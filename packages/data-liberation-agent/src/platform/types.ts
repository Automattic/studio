// src/platform/types.ts
//
// The public Platform contract. A Platform is the unit of extensibility for
// Data Liberation: it owns its own automatic-detection signals, must be able
// to discover a site's routes, and may optionally customize liberation. Platform
// ids are opaque strings — there is deliberately no platform enum.
//
// This module must stay dependency-free (types only) so consumers can import
// the contract without pulling in adapter internals.
import type { LiberationHooks } from '../adapters/page-actions.js';

/** URL substring/regex tested against the normalized site URL. */
export type PlatformUrlSignal = RegExp;

/**
 * HTTP response-header fingerprint. `header` is matched case-insensitively
 * (per fetch Headers semantics); when `value` is set it must appear as a
 * case-insensitive substring of the header value.
 */
export interface PlatformHttpSignal {
	header: string;
	value?: string;
	/** Human-readable evidence recorded in DetectionResult.signals. */
	signal: string;
}

/** Regex tested against the fetched page source (HTML). */
export interface PlatformSourceSignal {
	pattern: RegExp;
	/** Human-readable evidence recorded in DetectionResult.signals. */
	signal: string;
}

/**
 * Path-probe signal — issues an HTTP HEAD to `path` and matches on status
 * (and optionally the Location header). Probes only fire when URL, header,
 * and source tiers all fail: they pay an extra HTTP round-trip.
 */
export interface PlatformPathProbe {
	/** Path relative to site root, e.g. "/_emdash/admin". */
	path: string;
	/** Status codes that indicate a match (e.g. [302, 401]). */
	expectedStatus: number[];
	/**
	 * Optional substring that must appear in the response Location header.
	 * Tightens the probe against wildcard redirects on non-platform sites.
	 */
	locationContains?: string;
	/** Human-readable evidence recorded in DetectionResult.signals. */
	signal: string;
}

/**
 * Automatic-detection signals owned by a platform. Every tier is optional;
 * a platform with no `detection` can never be auto-detected (only the
 * registered fallback is selected implicitly).
 */
export interface PlatformDetection {
	/** Highest-priority tier: tested against the site URL before any fetch. */
	urlPatterns?: PlatformUrlSignal[];
	/** Response-header fingerprints, tested after the URL fetch. */
	httpSignals?: PlatformHttpSignal[];
	/** Page-source (HTML) markers, tested when no header matched. */
	sourceSignals?: PlatformSourceSignal[];
	/** Last-resort HEAD probes, fired only when every tier above failed. */
	pathProbes?: PlatformPathProbe[];
}

/**
 * A liberatable platform. `discover` is the one required capability —
 * everything else is opt-in.
 */
export interface Platform {
	/** Opaque, stable, unique id (e.g. 'wix', 'godaddy-wm', 'acme-builder'). */
	id: string;
	/** Automatic-detection signals owned by this platform. */
	detection?: PlatformDetection;
	/** Inventory a site: sitemap/routes/navigation. Required. */
	discover( url: string, opts: Record< string, unknown > ): Promise< unknown >;
	/** Optional platform-specific hooks applied while liberating each page. */
	liberation?: LiberationHooks;
}

/** Options accepted by {@link registerPlatform}. */
export interface RegisterPlatformOptions {
	/**
	 * Register this platform as THE generic fallback used when detection
	 * returns 'unknown' or names an unregistered platform. At most one
	 * fallback may exist; a fallback must not declare detection signals
	 * (that would be ambiguous with auto-detection).
	 */
	fallback?: boolean;
}
