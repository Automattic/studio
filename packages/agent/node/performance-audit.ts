/**
 * Frontend performance audit module for WordPress sites.
 *
 * Uses the host's browser to measure Core Web Vitals and page
 * composition metrics via the native Performance API and PerformanceObserver.
 */

import type { HostPages } from '@studio/agent/node/host';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssetBreakdown {
	count: number;
	totalBytes: number;
	urls: string[];
}

interface AuditMetrics {
	// Core Web Vitals timing (milliseconds)
	ttfb: number;
	fcp: number;
	lcp: number;

	// Layout stability (unitless score)
	cls: number;

	// Page composition
	domElements: number;
	totalRequests: number;
	pageWeightBytes: number;

	// Asset breakdown
	scripts: AssetBreakdown;
	stylesheets: AssetBreakdown;
	images: { count: number; totalBytes: number };
	fonts: { count: number; totalBytes: number };
}

export interface AuditResult {
	url: string;
	timestamp: string;
	metrics: AuditMetrics | null;
	error?: string;
}

// ---------------------------------------------------------------------------
// Injected observer script — runs before page navigation
// ---------------------------------------------------------------------------

/**
 * This script is injected via addInitScript so that PerformanceObserver
 * entries (FCP, LCP, CLS) are captured from the very start of page load.
 */
function observerSetupScript() {
	const audit = { lcpValue: 0, clsValue: 0, fcpValue: 0 };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	( window as any ).__auditMetrics = audit;

	try {
		// LCP — keep the latest entry's startTime
		new PerformanceObserver( ( list ) => {
			for ( const entry of list.getEntries() ) {
				audit.lcpValue = entry.startTime;
			}
		} ).observe( { type: 'largest-contentful-paint', buffered: true } );
	} catch {
		// Observer not supported — metrics will stay 0
	}

	try {
		// CLS — accumulate layout shifts that are not caused by user input
		new PerformanceObserver( ( list ) => {
			for ( const entry of list.getEntries() ) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				if ( ! ( entry as any ).hadRecentInput ) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					audit.clsValue += ( entry as any ).value ?? 0;
				}
			}
		} ).observe( { type: 'layout-shift', buffered: true } );
	} catch {
		// Observer not supported
	}

	try {
		// FCP — first-contentful-paint entry
		new PerformanceObserver( ( list ) => {
			for ( const entry of list.getEntries() ) {
				if ( entry.name === 'first-contentful-paint' ) {
					audit.fcpValue = entry.startTime;
				}
			}
		} ).observe( { type: 'paint', buffered: true } );
	} catch {
		// Observer not supported
	}
}

// ---------------------------------------------------------------------------
// Metric collection — runs after page load
// ---------------------------------------------------------------------------

function collectMetricsScript(): AuditMetrics {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const audit = ( window as any ).__auditMetrics ?? { lcpValue: 0, clsValue: 0, fcpValue: 0 };

	const navEntries = performance.getEntriesByType( 'navigation' );
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const nav = navEntries[ 0 ] as any;
	const ttfb = nav ? nav.responseStart - nav.requestStart : 0;

	const resources = performance.getEntriesByType( 'resource' );

	function getSize( entry: PerformanceResourceTiming ): number {
		return entry.transferSize || entry.encodedBodySize || 0;
	}

	function categorize( entry: PerformanceResourceTiming ): string {
		const url = entry.name.toLowerCase();
		const type = entry.initiatorType;
		if ( type === 'script' || url.endsWith( '.js' ) || url.endsWith( '.mjs' ) ) {
			return 'script';
		}
		if ( type === 'link' || type === 'css' || url.endsWith( '.css' ) ) {
			return 'stylesheet';
		}
		if ( type === 'img' || /\.(png|jpe?g|gif|svg|webp|avif|ico)/.test( url ) ) {
			return 'image';
		}
		if ( /\.(woff2?|ttf|otf|eot)/.test( url ) ) {
			return 'font';
		}
		return 'other';
	}

	const scripts: { count: number; totalBytes: number; urls: string[] } = {
		count: 0,
		totalBytes: 0,
		urls: [],
	};
	const stylesheets: { count: number; totalBytes: number; urls: string[] } = {
		count: 0,
		totalBytes: 0,
		urls: [],
	};
	const images = { count: 0, totalBytes: 0 };
	const fonts = { count: 0, totalBytes: 0 };
	let pageWeightBytes = 0;

	for ( const entry of resources ) {
		const res = entry as PerformanceResourceTiming;
		const size = getSize( res );
		pageWeightBytes += size;

		const category = categorize( res );
		switch ( category ) {
			case 'script':
				scripts.count++;
				scripts.totalBytes += size;
				scripts.urls.push( res.name );
				break;
			case 'stylesheet':
				stylesheets.count++;
				stylesheets.totalBytes += size;
				stylesheets.urls.push( res.name );
				break;
			case 'image':
				images.count++;
				images.totalBytes += size;
				break;
			case 'font':
				fonts.count++;
				fonts.totalBytes += size;
				break;
		}
	}

	// Add the document itself to page weight
	if ( nav ) {
		pageWeightBytes += getSize( nav );
	}

	return {
		ttfb: Math.round( ttfb ),
		fcp: Math.round( audit.fcpValue ),
		lcp: Math.round( audit.lcpValue ),
		cls: Math.round( audit.clsValue * 1000 ) / 1000,
		domElements: document.querySelectorAll( '*' ).length,
		totalRequests: resources.length,
		pageWeightBytes,
		scripts,
		stylesheets,
		images,
		fonts,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const AUDIT_VIEWPORT = { width: 1040, height: 1248 };

/** Extra wait after networkidle for late LCP candidates and layout shifts. */
const POST_LOAD_DELAY_MS = 2000;

export async function auditPerformance(
	pages: HostPages,
	siteUrl: string,
	urlPath = '/'
): Promise< AuditResult > {
	const targetUrl = `${ siteUrl.replace( /\/+$/, '' ) }${ urlPath }`;

	try {
		// The observers go in before the page's own scripts so FCP/LCP/CLS are
		// captured from the start; admin pages open signed in.
		const page = await pages.open(
			{ url: targetUrl, signIn: urlPath.startsWith( '/wp-admin' ) },
			{ viewport: AUDIT_VIEWPORT, initScript: observerSetupScript, waitUntil: 'networkidle' }
		);

		try {
			// Wait for late LCP candidates and layout shifts to settle.
			await new Promise( ( resolve ) => setTimeout( resolve, POST_LOAD_DELAY_MS ) );

			const metrics = await page.evaluate( collectMetricsScript );

			return {
				url: targetUrl,
				timestamp: new Date().toISOString(),
				metrics,
			};
		} finally {
			await page.close();
		}
	} catch ( error ) {
		return {
			url: targetUrl,
			timestamp: new Date().toISOString(),
			metrics: null,
			error: error instanceof Error ? error.message : String( error ),
		};
	}
}
