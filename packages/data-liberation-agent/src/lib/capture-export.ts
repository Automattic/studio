import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { MediaStubStore } from './resume-state/index.js';
import type { CapturedResourceManifest } from './screenshot/resource-capture.js';

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

interface PortableDependency {
	reference: string;
	url: string;
}

interface MediaCandidate {
	sourceUrl: string;
	localPath: string;
	references: string[];
	bytes: number;
	dimension: number;
}

const MAX_PORTABLE_MEDIA_BYTES = 5 * 1024 * 1024;
const MAX_PORTABLE_MEDIA_DIMENSION = 2048;

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
	const values = new Map< string, string >();
	for ( const [ source, local ] of replacements ) {
		values.set( source, local );
		values.set( source.replace( /&/g, '&amp;' ), local.replace( /&/g, '&amp;' ) );
	}
	const sources = [ ...values.keys() ].filter( Boolean ).sort( ( a, b ) => b.length - a.length );
	if ( sources.length === 0 ) return content;
	const pattern = new RegExp(
		sources.map( ( source ) => source.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) ).join( '|' ),
		'g'
	);
	return content.replace( pattern, ( source ) => values.get( source ) ?? source );
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

function mediaFamily( sourceUrl: string ): string {
	const url = new URL( sourceUrl );
	const parameters = [ ...url.searchParams.keys() ];
	return parameters.length > 0 && parameters.every( ( key ) => key === 'w' || key === 'h' )
		? `${ url.origin }${ url.pathname }`
		: sourceUrl;
}

function mediaDimension( sourceUrl: string ): number {
	const url = new URL( sourceUrl );
	return Math.max(
		Number( url.searchParams.get( 'w' ) ) || 0,
		Number( url.searchParams.get( 'h' ) ) || 0
	);
}

function selectMediaCandidate( candidates: MediaCandidate[] ): MediaCandidate {
	const bounded = candidates.filter(
		( candidate ) =>
			candidate.bytes <= MAX_PORTABLE_MEDIA_BYTES &&
			candidate.dimension <= MAX_PORTABLE_MEDIA_DIMENSION
	);
	return [ ...( bounded.length > 0 ? bounded : candidates ) ].sort(
		( a, b ) =>
			b.dimension - a.dimension || a.bytes - b.bytes || a.sourceUrl.localeCompare( b.sourceUrl )
	)[ 0 ];
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

function capturedResources( outputDir: string ): CapturedResourceManifest {
	const manifestPath = join( outputDir, 'resources', 'manifest.json' );
	if ( ! existsSync( manifestPath ) ) return { version: 1, resources: {}, failures: [] };
	try {
		const manifest = JSON.parse( readFileSync( manifestPath, 'utf8' ) ) as CapturedResourceManifest;
		return manifest.version === 1 && manifest.resources && Array.isArray( manifest.failures )
			? manifest
			: { version: 1, resources: {}, failures: [] };
	} catch {
		return {
			version: 1,
			resources: {},
			failures: [ { url: manifestPath, error: 'captured resource manifest is invalid' } ],
		};
	}
}

function dependencyReferences(
	html: string,
	documentUrl: string,
	siteUrl: string
): PortableDependency[] {
	const references = new Set< string >();
	const add = ( reference: string | undefined ) => {
		if ( reference ) references.add( reference.replace( /&amp;/g, '&' ) );
	};

	for ( const match of html.matchAll( /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi ) ) {
		add( match[ 1 ] );
	}
	for ( const match of html.matchAll( /<link\b[^>]*>/gi ) ) {
		const tag = match[ 0 ];
		const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec( tag )?.[ 1 ].toLowerCase() ?? '';
		const as = /\bas\s*=\s*["']([^"']+)["']/i.exec( tag )?.[ 1 ].toLowerCase() ?? '';
		if (
			rel.split( /\s+/ ).some( ( value ) => value === 'stylesheet' || value === 'modulepreload' ) ||
			( rel.split( /\s+/ ).includes( 'preload' ) &&
				[ 'script', 'style', 'font', 'fetch' ].includes( as ) )
		) {
			add( /\bhref\s*=\s*["']([^"']+)["']/i.exec( tag )?.[ 1 ] );
		}
	}
	for ( const match of html.matchAll( /\bimport\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g ) ) {
		add( match[ 1 ] );
	}

	const siteOrigin = new URL( siteUrl ).origin;
	return [ ...references ].flatMap( ( reference ) => {
		try {
			const url = new URL( reference, documentUrl );
			return url.origin === siteOrigin ? [ { reference, url: url.href } ] : [];
		} catch {
			return [];
		}
	} );
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
	const mediaFamilies = new Map< string, MediaCandidate[] >();
	for ( const [ sourceUrl, stub ] of MediaStubStore.load( outputDir ).list() ) {
		const references = mediaReferences( sourceUrl, options.sourceUrl );
		if (
			stub.status !== 'success' ||
			! stub.localPath ||
			! existsSync( stub.localPath ) ||
			! references.some( ( reference ) => containsMediaReference( retainedHtml, reference ) )
		)
			continue;
		const candidate: MediaCandidate = {
			sourceUrl,
			localPath: stub.localPath,
			references,
			bytes: statSync( stub.localPath ).size,
			dimension: mediaDimension( sourceUrl ),
		};
		const family = mediaFamily( sourceUrl );
		mediaFamilies.set( family, [ ...( mediaFamilies.get( family ) ?? [] ), candidate ] );
	}
	for ( const candidates of mediaFamilies.values() ) {
		const selected = selectMediaCandidate( candidates );
		const assetPath = join( 'media', basename( selected.localPath ) );
		const destination = join( websiteDir, assetPath );
		mkdirSync( dirname( destination ), { recursive: true } );
		copyFileSync( selected.localPath, destination );
		for ( const candidate of candidates ) {
			for ( const reference of candidate.references ) {
				mediaReplacements.set( reference, `/${ assetPath.replace( /\\/g, '/' ) }` );
			}
		}
		assets.push( {
			sourceUrl: selected.sourceUrl,
			path: join( 'website', assetPath ).replace( /\\/g, '/' ),
		} );
	}

	const resourceManifest = capturedResources( outputDir );
	const unresolvedDependencies: Array< { url: string; sourceUrl: string; error: string } > = [];
	const copiedResources = new Set< string >();
	for ( const entry of retainedEntries ) {
		for ( const dependency of dependencyReferences( entry.html, entry.url, options.sourceUrl ) ) {
			const resource = resourceManifest.resources[ dependency.url ];
			if ( ! resource ) {
				unresolvedDependencies.push( {
					url: dependency.url,
					sourceUrl: entry.url,
					error: 'referenced same-origin dependency was not captured',
				} );
				continue;
			}
			if ( copiedResources.has( resource.path ) ) continue;
			const source = resolve( outputDir, resource.path );
			const relativePath = resource.path.replace( /^resources[\\/]/, '' );
			const destination = resolve( websiteDir, relativePath );
			if (
				! pathWithin( outputDir, source ) ||
				! pathWithin( websiteDir, destination ) ||
				! existsSync( source )
			) {
				unresolvedDependencies.push( {
					url: dependency.url,
					sourceUrl: entry.url,
					error: 'captured dependency file is unavailable',
				} );
				continue;
			}
			mkdirSync( dirname( destination ), { recursive: true } );
			if ( /^(?:application\/json|text\/)/i.test( resource.contentType ) ) {
				writeFileSync( destination, replaceAll( readFileSync( source, 'utf8' ), mediaReplacements ) );
			} else {
				copyFileSync( source, destination );
			}
			copiedResources.add( resource.path );
			assets.push( {
				sourceUrl: dependency.url,
				path: `website/${ relativePath.replace( /\\/g, '/' ) }`,
			} );
		}
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
				resourceFailures: resourceManifest.failures,
				unresolvedDependencies,
				excludedRoutes,
			},
			null,
			2
		) }\n`
	);

	return receiptPath;
}
