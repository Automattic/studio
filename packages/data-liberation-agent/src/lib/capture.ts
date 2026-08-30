import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findAdapter } from '../adapters/index.js';
import type { PlatformAdapter } from '../types.js';
import { detect } from './detect-platform/index.js';
import { downloadMedia } from './media-fetch/media.js';
import { safeFetch } from './media-fetch/safe-fetch.js';
import { downloadSectionMedia } from './replicate/download-section-media.js';
import { SectionSpecsStore } from './replicate/section-specs-store.js';
import { MediaStubStore } from './resume-state/index.js';

export interface CaptureProgress {
	phase: 'discovering' | 'capturing' | 'finalizing' | 'complete';
	current?: number;
	total?: number;
	url?: string;
	elapsedMs?: number;
	phaseElapsedMs?: number;
}

export interface CaptureOptions {
	url: string;
	outputDir: string;
	resume?: boolean;
	captureImages?: boolean;
	/** Learn responsive sizing by sweeping widths instead of freezing one. */
	learnFluid?: boolean;
	onProgress?: ( progress: CaptureProgress ) => void;
}

export interface CaptureResult {
	artifactPath: string;
	captureReceiptPath: string;
	outputDir: string;
	summary: {
		routesDiscovered: number;
		routesCaptured: number;
		routesSkipped: number;
		routesFailed: number;
		durationMs: number;
	};
	failures: Array< { url: unknown; error: unknown } >;
	discoveryDiagnostics: Array< { code: string; url: string; reason: string } >;
	provenance: { provider: string; platform: string };
}

export interface CaptureDependencies {
	findAdapter( platform: string ): PlatformAdapter | null;
}

export class UnsupportedCapturePlatformError extends Error {}

const defaultDependencies: CaptureDependencies = { findAdapter };

interface CaptureInventory {
	siteMeta?: { title?: string };
	urls?: Array< { url: string; type: string } >;
	diagnostics?: Array< { code: string; url: string; reason: string } >;
}

function captureRouteKey( url: string ): string {
	const route = new URL( url );
	route.hash = '';
	route.search = '';
	route.pathname = route.pathname.replace( /\/$/, '' ) || '/';
	return route.href;
}

export async function downloadCaptureSectionMedia(
	outputDir: string,
	urls: string[]
): Promise< number > {
	const sectionUrls: string[] = [];
	for ( const store of [
		SectionSpecsStore.load( outputDir ),
		SectionSpecsStore.loadMobile( outputDir ),
	] ) {
		for ( const url of urls ) {
			for ( const section of store.get( url ) ?? [] ) {
				for ( const image of [
					...( section.images ?? [] ),
					...( section.cells ?? [] ).flatMap( ( cell ) => ( cell.image ? [ cell.image ] : [] ) ),
				] ) {
					sectionUrls.push( image.sourceUrl || image.url );
				}
			}
		}
	}

	const stubs = MediaStubStore.load( outputDir );
	const mediaDir = join( outputDir, 'media' );
	const seenNames = new Map< string, number >();
	const { downloaded } = await downloadSectionMedia( {
		srcUrls: sectionUrls,
		isAlreadyDone: ( url ) => ! stubs.shouldAttempt( url ),
		download: async ( url ) => {
			const result = await downloadMedia( url, mediaDir, seenNames );
			if ( result.error ) stubs.markFailure( url, result.error );
			return result.localPath;
		},
		onSuccess: ( url, localPath ) => stubs.markSuccess( url, localPath ),
	} );
	stubs.flush();
	return downloaded;
}

export async function captureWebsite(
	options: CaptureOptions,
	dependencies: CaptureDependencies = defaultDependencies
): Promise< CaptureResult > {
	const { onProgress } = options;
	const startedAt = Date.now();
	let phase = '';
	let phaseStartedAt = startedAt;
	const progress = ( event: CaptureProgress ): void => {
		const now = Date.now();
		if ( event.phase !== phase ) {
			phase = event.phase;
			phaseStartedAt = now;
		}
		const timedEvent = {
			...event,
			elapsedMs: now - startedAt,
			phaseElapsedMs: now - phaseStartedAt,
		};
		onProgress?.( timedEvent );
	};

	const response = await safeFetch( options.url, { timeoutMs: 10_000 } );
	const sourceUrl = response.finalUrl;
	const outputDir = options.outputDir;
	const detection = await detect( sourceUrl );
	const adapter = dependencies.findAdapter( detection.platform );
	if ( ! adapter )
		throw new UnsupportedCapturePlatformError(
			`No adapter available for platform: ${ detection.platform }`
		);

	progress( { phase: 'discovering', url: sourceUrl } );
	const inventory = ( await adapter.discover( sourceUrl, {
		outputDir,
		resume: options.resume === true,
	} ) ) as CaptureInventory;
	const sourceRoute = captureRouteKey( sourceUrl );
	const urls = [
		sourceUrl,
		...( inventory.urls ?? [] )
			.map( ( entry ) => entry.url )
			.filter( ( url ) => captureRouteKey( url ) !== sourceRoute ),
	];
	progress( { phase: 'capturing', current: 0, total: urls.length } );

	const { captureScreenshots } = await import( './screenshot/screenshotter.js' );
	const screenshotResult = await captureScreenshots( {
		urls,
		outputDir,
		primaryUrl: sourceUrl,
		captureImages: options.captureImages === true,
		learnFluid: options.learnFluid !== false,
		force: options.resume !== true,
		removeSelectors: adapter.capture?.removeSelectors,
		prepareCapture: adapter.capture?.prepare,
		...( adapter.capture?.responsiveImages
			? { collectResponsiveImages: adapter.capture.responsiveImages.bind( adapter.capture ) }
			: {} ),
		publicUrlsOnly: true,
		onProgress: ( current, total, url ) => progress( { phase: 'capturing', current, total, url } ),
	} );
	await downloadCaptureSectionMedia( outputDir, urls );

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
	return result;
}
