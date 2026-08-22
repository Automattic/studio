import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detect } from './detect-platform/index.js';
import { safeFetch } from './media-fetch/safe-fetch.js';
import type { HandlerContext, ToolResult } from '../mcp-server/handler-types.js';

export interface CaptureProgress {
	phase: 'discovering' | 'capturing' | 'finalizing' | 'complete';
	current?: number;
	total?: number;
	url?: string;
}

interface CaptureInventory {
	siteMeta?: { title?: string };
	urls?: Array< { url: string; type: string } >;
	diagnostics?: Array< { code: string; url: string; reason: string } >;
}

export async function captureWebsite(
	args: Record< string, unknown >,
	context: HandlerContext
): Promise< ToolResult > {
	const onProgress =
		typeof args.onProgress === 'function'
			? ( args.onProgress as ( progress: CaptureProgress ) => void )
			: undefined;
	const progress = ( event: CaptureProgress ): void => {
		onProgress?.( event );
		void context.server?.sendLoggingMessage?.( {
			level: 'info',
			data: JSON.stringify( { type: 'capture_progress', ...event } ),
		} );
	};

	const response = await safeFetch( String( args.url ?? '' ), { timeoutMs: 10_000 } );
	const sourceUrl = response.finalUrl;
	const outputDir = String( args.outputDir ?? '' );
	const detection = await detect( sourceUrl );
	const adapter = context.findAdapter( detection.platform );
	if ( ! adapter )
		return context.errorResult( `No adapter available for platform: ${ detection.platform }` );

	progress( { phase: 'discovering', url: sourceUrl } );
	const inventory = ( await adapter.discover( sourceUrl, {
		outputDir,
		resume: args.resume === true,
	} ) ) as CaptureInventory;
	const urls = ( inventory.urls ?? [] ).map( ( entry ) => entry.url );
	progress( { phase: 'capturing', current: 0, total: urls.length } );

	const { captureScreenshots } = await import( './screenshot/screenshotter.js' );
	const screenshotResult = await captureScreenshots( {
		urls,
		outputDir,
		primaryUrl: sourceUrl,
		captureImages: args.captureImages === true,
		force: args.resume !== true,
		removeSelectors: adapter.capture?.removeSelectors,
		prepareCapture: adapter.capture?.prepare,
		publicUrlsOnly: true,
		onProgress: ( current, total, url ) => progress( { phase: 'capturing', current, total, url } ),
	} );

	progress( { phase: 'finalizing', current: screenshotResult.captured, total: urls.length } );
	const failuresPath = join( outputDir, 'screenshots', 'failures.json' );
	const failures = existsSync( failuresPath )
		? ( JSON.parse( readFileSync( failuresPath, 'utf8' ) ) as Array< {
				url: unknown;
				error: unknown;
		  } > )
		: [];
	const summary = {
		routesDiscovered: urls.length,
		routesCaptured: screenshotResult.captured,
		routesSkipped: screenshotResult.skipped,
		routesFailed: screenshotResult.failed,
		durationMs: screenshotResult.durationMs,
	};
	const { exportWebsiteCapture } = await import( './capture-export.js' );
	const captureReceiptPath = exportWebsiteCapture( {
		outputDir,
		sourceUrl,
		platform: detection.platform,
		title: inventory.siteMeta?.title,
		summary,
		failures,
		discoveryDiagnostics: inventory.diagnostics ?? [],
	} );
	const result = {
		artifactPath: join( outputDir, 'artifact.json' ),
		captureReceiptPath,
		outputDir,
		summary,
		failures,
		discoveryDiagnostics: inventory.diagnostics ?? [],
		provenance: { provider: 'data-liberation/browser-capture', platform: detection.platform },
	};
	progress( { phase: 'complete', current: urls.length, total: urls.length } );
	return context.textResult( result );
}
