import fs from 'node:fs';
import path from 'node:path';
import { ensurePlaywrightChromiumInstalled } from 'cli/ai/browser-utils';
import { loadCaptureEngine, type CaptureEngine } from 'cli/lib/import-runtime';

// Routes the fidelity check compares against the live source. Each costs several
// browser round trips at more than one width, so it is a sample; the report says
// what was measured.
const FIDELITY_ROUTE_SAMPLE = 2;

type LoadEngine = () => Promise< CaptureEngine >;

type LiberateWebsiteOptions = {
	onProgress?: ( message: string ) => void;
	/** Called with a builder for the command that compares a site against the original. */
	onCompareCommand?: ( command: ( siteUrl: string ) => string ) => void;
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
 * A capture that failed on any route is not imported: the engine resolves even when routes failed, and building from it
 * would silently ship a site with missing pages.
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
		throw new Error(
			`Data Liberation failed on ${ failed } of ${
				result.summary.routesDiscovered
			} page(s); only ${ result.summary.routesCaptured } captured. Review ${ path.join(
				outputDir,
				'diagnostics.json'
			) }.`
		);
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
