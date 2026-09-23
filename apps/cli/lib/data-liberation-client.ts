import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ensurePlaywrightChromiumInstalled } from 'cli/ai/browser-utils';
import { loadCaptureEngine, type CaptureEngine } from 'cli/lib/import-runtime';

// Routes the fidelity check compares against the live source. Each costs several
// browser round trips at more than one width, so it is a sample; the report says
// what was measured.
const FIDELITY_ROUTE_SAMPLE = 2;

type LoadEngine = () => Promise< CaptureEngine >;

const captureReceiptSchema = z.object( {
	entrypoint: z.string().optional(),
	source: z.object( { url: z.string().optional() } ).optional(),
	discoveryDiagnostics: z
		.array( z.object( { code: z.string(), url: z.string(), reason: z.string() } ) )
		.optional(),
} );

// On any real source an occasional route fails for reasons the pipeline does not control:
// a source-side error, a timeout, a gated page. Dropping the whole import for those costs
// the user every route that did capture, so a capture that kept nearly all of its routes is
// imported and the missing ones are reported. Past this share the result is too incomplete
// to be worth creating, and the entry route is never tradeable: a site with no home page is
// not a usable outcome.
const MAX_DROPPED_ROUTE_RATIO = 0.1;
const ROUTE_CAPTURE_FAILED = 'route_capture_failed';

export type PartialCaptureReport = {
	routesDiscovered: number;
	droppedRoutes: Array< { url: string; reason: string } >;
	diagnosticsPath: string;
};

// The same page reaches the receipt spelled several ways: as http and https when the source
// redirects, with and without a trailing slash. A query string is not noise here, though --
// without pretty permalinks it is what selects the page.
function routeIdentity( url: string ): string {
	try {
		const route = new URL( url );
		return `${ route.host }${ route.pathname.replace( /\/$/, '' ) || '/' }${ route.search }`;
	} catch {
		return url;
	}
}

type LiberateWebsiteOptions = {
	onProgress?: ( message: string ) => void;
	/** Called with a builder for the command that compares a site against the original. */
	onCompareCommand?: ( command: ( siteUrl: string ) => string ) => void;
	onPartialCapture?: ( report: PartialCaptureReport ) => void;
	loadEngine?: LoadEngine;
};

/**
 * The Data Liberation CLI command that compares the site at `siteUrl`, route by route, against
 * the original source recorded in `captureRoot`.
 */
export function compareCommand( packageUrl: string, captureRoot: string, siteUrl: string ): string {
	return `npx --yes --package=${ packageUrl } data-liberation compare ${ JSON.stringify(
		captureRoot
	) } --candidate ${ siteUrl }`;
}

export type CaptureCompareResult = {
	/** Whether both of Data Liberation's fidelity tiers passed. */
	pass: boolean;
	/** A one-line summary of what was measured. */
	report: string;
};

// The release engine drives a real browser, so it is only loaded once Chromium is present.
async function loadEngineWithBrowser(): Promise< CaptureEngine > {
	const { chromium } = await import( 'playwright' );
	const browserProblem = await ensurePlaywrightChromiumInstalled( chromium );
	if ( browserProblem ) {
		throw new Error( browserProblem );
	}
	return loadCaptureEngine();
}

function captureDirectoryName( url: URL ): string {
	return url.hostname.replace( /[^a-z0-9.-]/gi, '-' ) || 'site';
}

/**
 * Capture `url` with the newest Data Liberation release and return the
 * portable `website/` directory it wrote.
 *
 * A capture that lost a few routes is still imported and the missing routes are reported; see
 * `checkPartialCapture`.
 */
export async function liberateWebsite(
	url: string,
	outputBase: string,
	options: LiberateWebsiteOptions = {}
): Promise< string > {
	const parsed = new URL( url );
	if ( ! [ 'http:', 'https:' ].includes( parsed.protocol ) ) {
		throw new Error( 'Source URLs must use HTTP or HTTPS.' );
	}

	const engine = await ( options.loadEngine ?? loadEngineWithBrowser )();
	const outputDir = path.join( path.resolve( outputBase ), captureDirectoryName( parsed ) );
	fs.mkdirSync( outputDir, { recursive: true } );
	options.onProgress?.( `Data Liberation ${ engine.version }` );
	const result = await engine.captureWebsite( {
		url: parsed.href,
		outputDir,
		onProgress: ( progress ) => {
			options.onProgress?.(
				progress.phase === 'capturing' && progress.total
					? `[liberate] ${ progress.current ?? 0 }/${ progress.total } ${
							progress.url ?? ''
					  }`.trim()
					: `[liberate] ${ progress.phase }`
			);
		},
	} );

	const failed = result?.summary?.routesFailed;
	if ( ! Number.isFinite( failed ) ) {
		throw new Error(
			'Data Liberation returned a missing or unusable route summary; the capture cannot be confirmed complete.'
		);
	}
	if ( failed > 0 ) {
		checkPartialCapture( parsed.href, outputDir, result.summary.routesDiscovered, options );
	}

	const websiteDir = path.join( outputDir, 'website' );
	if ( ! fs.existsSync( websiteDir ) || ! fs.statSync( websiteDir ).isDirectory() ) {
		throw new Error( 'Data Liberation completed without writing a website directory.' );
	}
	options.onCompareCommand?.( ( siteUrl ) =>
		compareCommand( engine.packageUrl, outputDir, siteUrl )
	);
	return websiteDir;
}

/**
 * A capture that lost a few routes is still imported, with the missing routes reported; one
 * that lost its entry route, more than a small share of routes, or its per-route diagnostics
 * is refused. `summary.routesFailed` counts failure records rather than routes -- one dead
 * route fails once per captured viewport -- so only the receipt's per-route diagnostics can
 * name the routes that produced no page.
 */
function checkPartialCapture(
	url: string,
	outputDir: string,
	routesDiscovered: number,
	options: LiberateWebsiteOptions
): void {
	const diagnosticsPath = path.join( outputDir, 'diagnostics.json' );
	const receiptPath = path.join( outputDir, 'capture-receipt.json' );
	let receipt: z.infer< typeof captureReceiptSchema >;
	try {
		receipt = captureReceiptSchema.parse( JSON.parse( fs.readFileSync( receiptPath, 'utf8' ) ) );
	} catch {
		throw new Error( `Data Liberation did not provide a valid capture receipt: ${ receiptPath }` );
	}
	if ( ! receipt.discoveryDiagnostics ) {
		throw new Error(
			`Data Liberation reported capture failures without per-route diagnostics. Review ${ diagnosticsPath } before importing.`
		);
	}
	const droppedRoutes = receipt.discoveryDiagnostics
		.filter( ( diagnostic ) => diagnostic.code === ROUTE_CAPTURE_FAILED )
		.map( ( { url: droppedUrl, reason } ) => ( { url: droppedUrl, reason } ) );
	if ( droppedRoutes.length === 0 ) {
		return;
	}
	const entryRoute = receipt.source?.url ?? url;
	const entryRouteIdentity = routeIdentity( entryRoute );
	const entrypointPath = receipt.entrypoint && path.resolve( outputDir, receipt.entrypoint );
	if (
		( entrypointPath && ! fs.existsSync( entrypointPath ) ) ||
		droppedRoutes.some( ( route ) => routeIdentity( route.url ) === entryRouteIdentity )
	) {
		throw new Error(
			`Data Liberation could not capture the entry route ${ entryRoute }. Review ${ diagnosticsPath } before importing.`
		);
	}
	if ( ! ( routesDiscovered > 0 ) ) {
		throw new Error(
			`Data Liberation did not report how many routes it discovered. Review ${ diagnosticsPath } before importing.`
		);
	}
	if ( droppedRoutes.length / routesDiscovered > MAX_DROPPED_ROUTE_RATIO ) {
		throw new Error(
			`Data Liberation could not capture ${ droppedRoutes.length } of ${ routesDiscovered } routes. Review ${ diagnosticsPath } before importing.`
		);
	}
	options.onPartialCapture?.( { routesDiscovered, droppedRoutes, diagnosticsPath } );
}

/**
 * Measure a capture against its live source with Data Liberation's own
 * fidelity check. The result is evidence about the capture, never a gate on
 * the import.
 */
export async function compareLiberatedCapture(
	directory: string,
	options: { onProgress?: ( message: string ) => void; loadEngine?: LoadEngine } = {}
): Promise< CaptureCompareResult > {
	const engine = await ( options.loadEngine ?? loadEngineWithBrowser )();
	const report = await engine.checkFidelity( {
		directory,
		sampleSize: FIDELITY_ROUTE_SAMPLE,
		log: options.onProgress,
	} );
	const routes = Array.isArray( report.routes ) ? report.routes.length : 0;
	const scores = Array.isArray( report.scores )
		? ( report.scores as Array< { failures?: unknown[] } > )
		: [];
	const failedChecks = scores.reduce(
		( total, score ) => total + ( Array.isArray( score.failures ) ? score.failures.length : 0 ),
		0
	);
	const consistency = ( report.selfConsistency ?? {} ) as { routes?: number; findings?: unknown[] };
	const findings = Array.isArray( consistency.findings ) ? consistency.findings.length : 0;
	return {
		pass: report.pass === true,
		report: `${ failedChecks } source check(s) failed across ${ routes } compared route(s); ${ findings } offline finding(s) across ${
			consistency.routes ?? 0
		} route(s).`,
	};
}
