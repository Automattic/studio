import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ensurePlaywrightChromiumInstalled } from 'cli/ai/browser-utils';

const captureReceiptSchema = z.object( {
	schema: z.literal( 'data-liberation/capture-receipt/v1' ),
	entrypoint: z.string().optional(),
	source: z.object( { url: z.string().optional() } ).optional(),
	discoveryDiagnostics: z
		.array( z.object( { code: z.string(), url: z.string(), reason: z.string() } ) )
		.optional(),
	summary: z.object( {
		routesDiscovered: z.number().int().nonnegative().optional(),
		routesFailed: z.number().int().nonnegative(),
	} ),
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

type DataLiberationCliResult = {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
};

export type RunDataLiberationCli = (
	args: string[],
	onProgress?: ( message: string ) => void
) => Promise< DataLiberationCliResult >;

type LiberateWebsiteOptions = {
	onProgress?: ( message: string ) => void;
	onPartialCapture?: ( report: PartialCaptureReport ) => void;
	runCli?: RunDataLiberationCli;
};

export type CaptureCompareResult = {
	/** Whether both of DLA's own fidelity tiers passed. */
	pass: boolean;
	/** The human-readable verdict `data-liberation compare` printed to stdout. */
	report: string;
};

type CompareLiberatedCaptureOptions = {
	onProgress?: ( message: string ) => void;
	runCli?: RunDataLiberationCli;
};

export function getDataLiberationCliPath(): string {
	return path.join( import.meta.dirname, 'data-liberation-agent', 'dist', 'cli.js' );
}

function appendBounded( current: string, chunk: string ): string {
	return ( current + chunk ).slice( -64 * 1024 );
}

async function runDataLiberationCli(
	args: string[],
	onProgress?: ( message: string ) => void
): Promise< DataLiberationCliResult > {
	const { chromium } = await import( 'playwright' );
	const browserProblem = await ensurePlaywrightChromiumInstalled( chromium );
	if ( browserProblem ) {
		throw new Error( browserProblem );
	}

	const cliPath = getDataLiberationCliPath();
	if ( ! fs.existsSync( cliPath ) ) {
		throw new Error(
			'Data Liberation CLI is not compiled. Run `npm -w data-liberation run build` and try again.'
		);
	}

	return new Promise( ( resolve, reject ) => {
		const child = spawn( process.execPath, [ cliPath, ...args ], {
			cwd: path.dirname( path.dirname( cliPath ) ),
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		} );
		let stdout = '';
		let stderr = '';
		let pendingProgress = '';

		child.stdout.setEncoding( 'utf8' );
		child.stderr.setEncoding( 'utf8' );
		child.stdout.on( 'data', ( chunk: string ) => {
			stdout = appendBounded( stdout, chunk );
		} );
		child.stderr.on( 'data', ( chunk: string ) => {
			stderr = appendBounded( stderr, chunk );
			pendingProgress += chunk;
			const lines = pendingProgress.split( /\r?\n/ );
			pendingProgress = lines.pop() ?? '';
			for ( const line of lines ) {
				if ( line.trim() ) {
					onProgress?.( line.trim() );
				}
			}
		} );
		child.once( 'error', reject );
		child.once( 'close', ( code, signal ) => {
			if ( pendingProgress.trim() ) {
				onProgress?.( pendingProgress.trim() );
			}
			resolve( { exitCode: code, signal, stdout, stderr } );
		} );
	} );
}

export async function liberateWebsite(
	url: string,
	outputBase: string,
	options: LiberateWebsiteOptions = {}
): Promise< string > {
	const parsed = new URL( url );
	if ( ! [ 'http:', 'https:' ].includes( parsed.protocol ) ) {
		throw new Error( 'Source URLs must use HTTP or HTTPS.' );
	}

	const resolvedOutputBase = path.resolve( outputBase );
	fs.mkdirSync( resolvedOutputBase, { recursive: true } );
	const result = await ( options.runCli ?? runDataLiberationCli )(
		[ parsed.href, '--output', resolvedOutputBase, '--resume' ],
		options.onProgress
	);
	if ( result.signal ) {
		throw new Error( `Data Liberation was terminated by ${ result.signal }.` );
	}
	if ( result.exitCode !== 0 ) {
		throw new Error( result.stderr.trim() || result.stdout.trim() || 'Data Liberation failed.' );
	}

	const siteLine = result.stdout
		.trim()
		.split( /\r?\n/ )
		.reverse()
		.find( ( line ) => line.startsWith( 'Site: ' ) );
	if ( ! siteLine ) {
		throw new Error( 'Data Liberation completed without reporting a website directory.' );
	}

	const websiteDir = path.resolve( siteLine.slice( 'Site: '.length ).trim() );
	const relativeWebsiteDir = path.relative( resolvedOutputBase, websiteDir );
	if (
		relativeWebsiteDir === '..' ||
		relativeWebsiteDir.startsWith( `..${ path.sep }` ) ||
		! fs.existsSync( websiteDir ) ||
		! fs.statSync( websiteDir ).isDirectory()
	) {
		throw new Error( 'Data Liberation reported an invalid website directory.' );
	}

	const captureRoot = path.dirname( websiteDir );
	const receiptPath = path.join( captureRoot, 'capture-receipt.json' );
	let receipt: z.infer< typeof captureReceiptSchema >;
	try {
		receipt = captureReceiptSchema.parse( JSON.parse( fs.readFileSync( receiptPath, 'utf8' ) ) );
	} catch {
		throw new Error( `Data Liberation did not provide a valid capture receipt: ${ receiptPath }` );
	}

	if ( receipt.summary.routesFailed === 0 ) {
		return websiteDir;
	}

	// `summary.routesFailed` counts failure records rather than routes — one dead route fails
	// once per captured viewport — so it answers "did anything fail", not "how much is
	// missing". Only the receipt's per-route diagnostics name the routes that produced no
	// page, and a receipt that omits them cannot be judged at all, so it keeps the strict
	// outcome.
	const diagnosticsPath = path.join( captureRoot, 'diagnostics.json' );
	if ( ! receipt.discoveryDiagnostics ) {
		throw new Error(
			`Data Liberation reported ${ receipt.summary.routesFailed } capture failures without per-route diagnostics. Review ${ diagnosticsPath } before importing.`
		);
	}

	const droppedRoutes = receipt.discoveryDiagnostics
		.filter( ( diagnostic ) => diagnostic.code === ROUTE_CAPTURE_FAILED )
		.map( ( { url, reason } ) => ( { url, reason } ) );
	if ( droppedRoutes.length === 0 ) {
		return websiteDir;
	}

	const entryRoute = receipt.source?.url ?? parsed.href;
	const entryRouteIdentity = routeIdentity( entryRoute );
	const entrypointPath = receipt.entrypoint && path.resolve( captureRoot, receipt.entrypoint );
	if (
		( entrypointPath && ! fs.existsSync( entrypointPath ) ) ||
		droppedRoutes.some( ( route ) => routeIdentity( route.url ) === entryRouteIdentity )
	) {
		throw new Error(
			`Data Liberation could not capture the entry route ${ entryRoute }. Review ${ diagnosticsPath } before importing.`
		);
	}

	const routesDiscovered = receipt.summary.routesDiscovered ?? 0;
	if ( routesDiscovered <= 0 ) {
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

	return websiteDir;
}

// Verifies a Data Liberation capture against its live source with DLA's own fidelity gate
// (`src/lib/fidelity/`), the same measurement `data-liberation compare` runs standalone.
// `directory` is a capture root or its `website/` directory — DLA's own `compare` resolves
// either shape, so callers do not need to know which one they have (see
// `resolveCheckDirectory` in DLA's `lib/fidelity/check.ts`). The verdict, not a re-derived
// one: Studio decides *when* to run this and what a failure means for the import, but never
// re-measures fidelity itself.
export async function compareLiberatedCapture(
	directory: string,
	options: CompareLiberatedCaptureOptions = {}
): Promise< CaptureCompareResult > {
	const result = await ( options.runCli ?? runDataLiberationCli )(
		[ 'compare', directory ],
		options.onProgress
	);
	if ( result.signal ) {
		throw new Error( `Data Liberation compare was terminated by ${ result.signal }.` );
	}
	// `compare`'s verdict lines go to stdout; `[compare] ...` progress ticks go to stderr (see
	// `onProgress` above and `src/ui/compare.ts` upstream).
	const report = result.stdout.trim() || result.stderr.trim();
	if ( ! report ) {
		throw new Error( 'Data Liberation compare produced no output.' );
	}
	return { pass: result.exitCode === 0, report };
}
