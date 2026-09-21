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
const MAX_FAILED_ROUTE_RATIO = 0.1;

export type PartialCaptureReport = {
	routesDiscovered: number;
	routesFailed: number;
	failedRoutes: Array< { url: string; reason: string } >;
	diagnosticsPath: string;
};

function routeIdentity( url: string ): string {
	try {
		const route = new URL( url );
		route.hash = '';
		route.search = '';
		route.pathname = route.pathname.replace( /\/$/, '' ) || '/';
		return route.href;
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

	const routesFailed = receipt.summary.routesFailed;
	if ( routesFailed > 0 ) {
		const diagnosticsPath = path.join( captureRoot, 'diagnostics.json' );
		const routesDiscovered = receipt.summary.routesDiscovered ?? 0;
		const failedRoutes = ( receipt.discoveryDiagnostics ?? [] )
			.filter( ( diagnostic ) => diagnostic.code === 'route_capture_failed' )
			.map( ( { url, reason } ) => ( { url, reason } ) );
		const entrypointPath = receipt.entrypoint
			? path.resolve( captureRoot, receipt.entrypoint )
			: path.join( websiteDir, 'index.html' );
		const entryRoute = routeIdentity( receipt.source?.url ?? parsed.href );
		if (
			! fs.existsSync( entrypointPath ) ||
			failedRoutes.some( ( route ) => routeIdentity( route.url ) === entryRoute )
		) {
			throw new Error(
				`Data Liberation could not capture the entry route ${ entryRoute }. Review ${ diagnosticsPath } before importing.`
			);
		}
		if ( routesDiscovered <= 0 || routesFailed / routesDiscovered > MAX_FAILED_ROUTE_RATIO ) {
			throw new Error(
				`Data Liberation captured ${ Math.max(
					routesDiscovered - routesFailed,
					0
				) } of ${ routesDiscovered } routes and reported ${ routesFailed } capture failures. Review ${ diagnosticsPath } before importing.`
			);
		}
		options.onPartialCapture?.( { routesDiscovered, routesFailed, failedRoutes, diagnosticsPath } );
	}

	return websiteDir;
}
