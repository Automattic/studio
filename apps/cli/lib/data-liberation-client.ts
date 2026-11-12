import fs from 'node:fs';
import path from 'node:path';
import { ensurePlaywrightChromiumInstalled } from '@studio/agent/node';
import { z } from 'zod';
import {
	loadCaptureEngine,
	resolveCaptureEngineAsset,
	type CaptureEngine,
} from 'cli/lib/import-runtime';

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
// the user every route that did capture, so a capture with its entry route is imported and
// its dropped routes are reported.
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
	/** Freeze reference evidence for every route, so the compare command covers each page. */
	referenceEveryRoute?: boolean;
	loadEngine?: LoadEngine;
};

type LiberatedWebsite = {
	/** The portable `website/` directory to import. */
	websiteDir: string;
	/** Builds the command that compares a site at `siteUrl` against the original, route by route. */
	compareCommand: ( siteUrl: string ) => string;
	/** Set when routes could not be captured; the site is imported without them. */
	partialCapture?: PartialCaptureReport;
};

/**
 * The Data Liberation CLI command that compares the site at `siteUrl`, route by route, against
 * the original source recorded in `captureRoot`.
 */
function compareCommand( packageUrl: string, captureRoot: string, siteUrl: string ): string {
	return `npx --yes --package=${ packageUrl } data-liberation compare ${ JSON.stringify(
		captureRoot
	) } --candidate ${ siteUrl }`;
}

// The release engine drives a real browser, so it is only loaded once Chromium is present.
async function loadEngineWithBrowser(): Promise< CaptureEngine > {
	const { chromium } = await import( 'playwright' );
	const browserProblem = await ensurePlaywrightChromiumInstalled( chromium );
	if ( browserProblem ) {
		throw new Error( browserProblem );
	}
	return loadCaptureEngine();
}

/** Where `liberateWebsite` writes the capture of `url` inside `outputBase`. */
export function captureRootFor( url: string, outputBase: string ): string {
	const hostname = new URL( url ).hostname.replace( /[^a-z0-9.-]/gi, '-' ) || 'site';
	return path.join( path.resolve( outputBase ), hostname );
}

/** The compare command for an existing capture, using the newest Data Liberation release. */
export async function captureCompareCommand(
	captureRoot: string
): Promise< ( siteUrl: string ) => string > {
	const { url } = await resolveCaptureEngineAsset();
	return ( siteUrl ) => compareCommand( url, captureRoot, siteUrl );
}

/**
 * Capture `url` with the newest Data Liberation release and return the
 * portable `website/` directory it wrote.
 *
 * A capture with its entry route is imported and its dropped routes are reported; see
 * `checkPartialCapture`.
 */
export async function liberateWebsite(
	url: string,
	outputBase: string,
	options: LiberateWebsiteOptions = {}
): Promise< LiberatedWebsite > {
	const parsed = new URL( url );
	if ( ! [ 'http:', 'https:' ].includes( parsed.protocol ) ) {
		throw new Error( 'Source URLs must use HTTP or HTTPS.' );
	}

	const engine = await ( options.loadEngine ?? loadEngineWithBrowser )();
	const outputDir = captureRootFor( parsed.href, outputBase );
	fs.mkdirSync( outputDir, { recursive: true } );
	options.onProgress?.( `Data Liberation ${ engine.version }` );
	const result = await engine.captureWebsite( {
		url: parsed.href,
		outputDir,
		...( options.referenceEveryRoute ? { referenceSample: 'all' as const } : {} ),
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
	const partialCapture =
		failed > 0
			? checkPartialCapture( parsed.href, outputDir, result.summary.routesDiscovered )
			: undefined;

	const websiteDir = path.join( outputDir, 'website' );
	if ( ! fs.existsSync( websiteDir ) || ! fs.statSync( websiteDir ).isDirectory() ) {
		throw new Error( 'Data Liberation completed without writing a website directory.' );
	}
	return {
		websiteDir,
		compareCommand: ( siteUrl ) => compareCommand( engine.packageUrl, outputDir, siteUrl ),
		partialCapture,
	};
}

/**
 * A capture with its entry route is imported and its dropped routes are reported; one
 * that lost its entry route or its per-route diagnostics is refused.
 * `summary.routesFailed` counts failure records rather than routes -- one dead
 * route fails once per captured viewport -- so only the receipt's per-route diagnostics can
 * name the routes that produced no page.
 */
function checkPartialCapture(
	url: string,
	outputDir: string,
	routesDiscovered: number
): PartialCaptureReport | undefined {
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
		return undefined;
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
	return { routesDiscovered, droppedRoutes, diagnosticsPath };
}
