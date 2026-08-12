import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { MediaStubStore } from './resume-state/index.js';

export const CAPTURE_RECEIPT_SCHEMA = 'data-liberation/capture-receipt/v1';

interface CaptureManifestEntry {
	html?: string;
	metadata?: {
		openGraph?: Record< string, string >;
	};
}

interface ScreenshotManifest {
	version: 1;
	entries: Record< string, CaptureManifestEntry >;
}

interface ExportCaptureOptions {
	outputDir: string;
	sourceUrl: string;
	platform: string;
	title?: string;
	summary: Record< string, unknown >;
	failures: Array< { url: unknown; error: unknown } >;
}

function pathWithin( root: string, candidate: string ): boolean {
	const rel = relative( resolve( root ), resolve( candidate ) );
	return rel === '' || ( ! rel.startsWith( `..${ sep }` ) && rel !== '..' );
}

function normalizedUrl( url: string ): string {
	const parsed = new URL( url );
	parsed.hash = '';
	parsed.search = '';
	parsed.pathname = parsed.pathname.replace( /\/$/, '' ) || '/';
	return parsed.href;
}

function routeOutputPath( url: string, sourceUrl: string, entrypointUrl: string ): string {
	if ( url === entrypointUrl ) return 'index.html';
	const route = new URL( url );
	const source = new URL( sourceUrl );
	let pathname = decodeURIComponent( route.pathname );
	const sourcePath = source.pathname.replace( /\/$/, '' );

	if ( route.origin === source.origin && sourcePath && pathname.startsWith( `${ sourcePath }/` ) ) {
		pathname = pathname.slice( sourcePath.length );
	} else if ( route.origin === source.origin && pathname.replace( /\/$/, '' ) === sourcePath ) {
		pathname = '/';
	}

	const cleanPath = pathname.replace( /^\/+|\/+$/g, '' );
	if ( ! cleanPath ) return 'index.html';
	if ( /\.[a-z0-9]+$/i.test( cleanPath ) ) return cleanPath;
	return join( cleanPath, 'index.html' );
}

function replaceAll( content: string, replacements: Map< string, string > ): string {
	for ( const [ source, local ] of [ ...replacements ].sort(
		( [ a ], [ b ] ) => b.length - a.length
	) ) {
		content = content.split( source ).join( local );
		content = content
			.split( source.replace( /&/g, '&amp;' ) )
			.join( local.replace( /&/g, '&amp;' ) );
	}
	return content;
}

function mediaReferences( sourceUrl: string, siteUrl: string ): string[] {
	const media = new URL( sourceUrl );
	const site = new URL( siteUrl );
	return media.origin === site.origin
		? [ sourceUrl, `${ media.pathname }${ media.search }` ]
		: [ sourceUrl ];
}

function containsMediaReference( content: string, reference: string ): boolean {
	for ( const candidate of [ reference, reference.replace( /&/g, '&amp;' ) ] ) {
		let offset = content.indexOf( candidate );
		while ( offset !== -1 ) {
			const suffix = content.slice( offset + candidate.length );
			if (
				new URL( reference, 'https://example.com' ).search ||
				( ! suffix.startsWith( '?' ) && ! suffix.startsWith( '&amp;' ) )
			) {
				return true;
			}
			offset = content.indexOf( candidate, offset + candidate.length );
		}
	}
	return false;
}

function routeInSourceScope( url: string, sourceUrl: string ): boolean {
	const route = new URL( url );
	const source = new URL( sourceUrl );
	const sourcePath = source.pathname.replace( /\/$/, '' );
	const routePath = route.pathname.replace( /\/$/, '' );
	return (
		route.origin === source.origin &&
		( routePath === sourcePath || routePath.startsWith( `${ sourcePath }/` ) )
	);
}

export function exportWebsiteCapture( options: ExportCaptureOptions ): string {
	const outputDir = resolve( options.outputDir );
	const screenshotManifestPath = join( outputDir, 'screenshots', 'manifest.json' );
	if ( ! existsSync( screenshotManifestPath ) ) {
		throw new Error( `Screenshot manifest not found: ${ screenshotManifestPath }` );
	}

	const capture = JSON.parse(
		readFileSync( screenshotManifestPath, 'utf8' )
	) as ScreenshotManifest;
	if ( capture.version !== 1 || ! capture.entries || typeof capture.entries !== 'object' ) {
		throw new Error( `Invalid screenshot manifest: ${ screenshotManifestPath }` );
	}

	const websiteDir = join( outputDir, 'website' );
	rmSync( websiteDir, { recursive: true, force: true } );
	mkdirSync( websiteDir, { recursive: true } );

	const retainedEntries: Array< { url: string; html: string; canonicalUrl?: string } > = [];
	const excludedRoutes: string[] = [];
	for ( const [ url, entry ] of Object.entries( capture.entries ) ) {
		if ( ! routeInSourceScope( url, options.sourceUrl ) ) {
			excludedRoutes.push( url );
			continue;
		}
		if ( ! entry.html ) continue;
		const htmlPath = resolve( outputDir, entry.html );
		if ( ! pathWithin( outputDir, htmlPath ) || ! existsSync( htmlPath ) ) continue;
		retainedEntries.push( {
			url,
			html: readFileSync( htmlPath, 'utf8' ),
			canonicalUrl: entry.metadata?.openGraph?.[ 'og:url' ],
		} );
	}

	const normalizedSourceUrl = normalizedUrl( options.sourceUrl );
	const entrypointCandidates = retainedEntries.filter(
		( { url, canonicalUrl } ) =>
			normalizedUrl( url ) === normalizedSourceUrl ||
			( canonicalUrl !== undefined && normalizedUrl( canonicalUrl ) === normalizedSourceUrl )
	);
	if ( entrypointCandidates.length !== 1 ) {
		throw new Error(
			`Capture does not identify one rendered homepage for the source URL: ${ options.sourceUrl }`
		);
	}
	const entrypointUrl = entrypointCandidates[ 0 ].url;

	const retainedHtml = retainedEntries.map( ( entry ) => entry.html ).join( '\n' );
	const mediaReplacements = new Map< string, string >();
	const assets: Array< { sourceUrl: string; path: string } > = [];
	for ( const [ sourceUrl, stub ] of MediaStubStore.load( outputDir ).list() ) {
		const references = mediaReferences( sourceUrl, options.sourceUrl );
		if (
			stub.status !== 'success' ||
			! stub.localPath ||
			! existsSync( stub.localPath ) ||
			! references.some( ( reference ) => containsMediaReference( retainedHtml, reference ) )
		)
			continue;
		const assetPath = join( 'media', basename( stub.localPath ) );
		const destination = join( websiteDir, assetPath );
		mkdirSync( dirname( destination ), { recursive: true } );
		copyFileSync( stub.localPath, destination );
		for ( const reference of references ) {
			mediaReplacements.set( reference, `/${ assetPath.replace( /\\/g, '/' ) }` );
		}
		assets.push( { sourceUrl, path: join( 'website', assetPath ).replace( /\\/g, '/' ) } );
	}

	const routes: Array< { url: string; path: string } > = [];
	const claimedPaths = new Set< string >();
	for ( const { url, html } of retainedEntries ) {
		const routePath = routeOutputPath( url, options.sourceUrl, entrypointUrl ).replace(
			/\\/g,
			'/'
		);
		if ( claimedPaths.has( routePath ) ) {
			throw new Error( `Captured routes resolve to the same website path: ${ routePath }` );
		}
		claimedPaths.add( routePath );

		const destination = join( websiteDir, routePath );
		if ( ! pathWithin( websiteDir, destination ) ) {
			throw new Error( `Captured route escapes the website directory: ${ url }` );
		}
		mkdirSync( dirname( destination ), { recursive: true } );
		writeFileSync( destination, replaceAll( html, mediaReplacements ) );
		routes.push( { url, path: `website/${ routePath }` } );
	}

	const receiptPath = join( outputDir, 'capture-receipt.json' );
	writeFileSync(
		receiptPath,
		`${ JSON.stringify(
			{
				schema: CAPTURE_RECEIPT_SCHEMA,
				websiteRoot: 'website',
				entrypoint: 'website/index.html',
				source: { url: options.sourceUrl, platform: options.platform },
				...( options.title ? { title: options.title } : {} ),
				routes,
				assets,
				excludedRoutes,
				summary: options.summary,
			},
			null,
			2
		) }\n`
	);
	writeFileSync(
		join( outputDir, 'diagnostics.json' ),
		`${ JSON.stringify(
			{
				schema: 'data-liberation/capture-diagnostics/v1',
				failures: options.failures,
				excludedRoutes,
			},
			null,
			2
		) }\n`
	);

	return receiptPath;
}
