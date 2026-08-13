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
export const WEBSITE_ARTIFACT_SCHEMA = 'blocks-engine/php-transformer/site-artifact/v1';

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
	kind: 'resource' | 'media' | 'css';
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
const TRANSPARENT_IMAGE_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

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

function renderedHtml( html: string ): string {
	return html.replace( /<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, '' );
}

const RESPONSIVE_DOCUMENT_CSS =
	'.data-liberation-mobile-document{display:none!important}@media(max-width:768px){.data-liberation-desktop-document{display:none!important}.data-liberation-mobile-document{display:contents!important}}';

function responsiveHtml( desktopHtml: string, mobileHtml: string ): string {
	const desktopBody = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec( desktopHtml )?.[ 1 ];
	const mobileBody = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec( mobileHtml )?.[ 1 ];
	if ( desktopBody === undefined || mobileBody === undefined ) return desktopHtml;

	const responsiveBody = `<div class="data-liberation-desktop-document">${ desktopBody }</div><div class="data-liberation-mobile-document">${ mobileBody }</div>`;
	return desktopHtml
		.replace( /<\/head\s*>/i, `<style>${ RESPONSIVE_DOCUMENT_CSS }</style></head>` )
		.replace( /(<body\b[^>]*>)[\s\S]*?(<\/body\s*>)/i, `$1${ responsiveBody }$2` );
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
	const searchableHtml = html
		.replace( /&quot;|&#34;|&#x22;/gi, '"' )
		.replace( /&apos;|&#39;|&#x27;/gi, "'" );
	const references = new Set< string >();
	const add = ( reference: string | undefined ) => {
		if ( reference ) references.add( reference.replace( /&amp;/g, '&' ) );
	};

	for ( const match of searchableHtml.matchAll( /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi ) ) {
		add( match[ 1 ] );
	}
	const mediaReferences = new Set< string >();
	const cssReferences = new Set< string >();
	for ( const match of searchableHtml.matchAll(
		/<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
	) ) {
		mediaReferences.add( match[ 1 ].replace( /&amp;/g, '&' ) );
		add( match[ 1 ] );
	}
	for ( const match of searchableHtml.matchAll(
		/<(?:img|source)\b[^>]*\bsrcset\s*=\s*["']([^"']+)["'][^>]*>/gi
	) ) {
		for ( const candidate of match[ 1 ].split( ',' ) ) {
			const reference = candidate.trim().split( /\s+/, 1 )[ 0 ];
			if ( reference ) {
				mediaReferences.add( reference.replace( /&amp;/g, '&' ) );
				add( reference );
			}
		}
	}
	for ( const match of searchableHtml.matchAll( /<link\b[^>]*>/gi ) ) {
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
	for ( const match of searchableHtml.matchAll( /\bimport\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g ) ) {
		add( match[ 1 ] );
	}
	for ( const match of searchableHtml.matchAll( /\burl\(\s*(?:["']([^"']+)["']|([^\s)'";]+))\s*\)/gi ) ) {
		const reference = match[ 1 ] ?? match[ 2 ];
		if ( reference && ! reference.startsWith( 'data:' ) ) {
			cssReferences.add( reference.replace( /&amp;/g, '&' ) );
			add( reference );
		}
	}

	const siteOrigin = new URL( siteUrl ).origin;
	return [ ...references ].flatMap( ( reference ) => {
		try {
			const url = new URL( reference, documentUrl );
			return url.origin === siteOrigin
				? [
						{
							reference,
							url: url.href,
							kind: mediaReferences.has( reference )
								? 'media'
								: cssReferences.has( reference )
								? 'css'
								: 'resource',
						},
				  ]
				: [];
		} catch {
			return [];
		}
	} );
}

function removeDanglingMediaSource( html: string, reference: string ): string {
	const normalizedReference = reference.replace( /&amp;/g, '&' );
	return html.replace( /<(img|source|video|audio)\b[^>]*>/gi, ( tag ) => {
		const element = /^<(\w+)/.exec( tag )?.[ 1 ].toLowerCase();
		const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec( tag )?.[ 1 ].replace( /&amp;/g, '&' );
		return src === normalizedReference
			? element === 'img'
				? tag.replace( /\s+src\s*=\s*["'][^"']*["']/i, ` src="${ TRANSPARENT_IMAGE_DATA_URL }"` )
				: tag.replace( /\s+src\s*=\s*["'][^"']*["']/i, '' )
			: tag;
	} );
}

function replaceDanglingCssUrl( html: string, reference: string ): string {
	return replaceAll( html, new Map( [ [ reference, 'data:application/octet-stream;base64,' ] ] ) );
}

function removeDanglingPreload( html: string, reference: string ): string {
	const normalizedReference = reference.replace( /&amp;/g, '&' );
	return html.replace( /<link\b[^>]*>/gi, ( tag ) => {
		const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec( tag )?.[ 1 ].toLowerCase() ?? '';
		const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec( tag )?.[ 1 ].replace( /&amp;/g, '&' );
		const relations = rel.split( /\s+/ );
		return href === normalizedReference &&
			( relations.includes( 'preload' ) || relations.includes( 'modulepreload' ) )
			? ''
			: tag;
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
		let html = renderedHtml( readFileSync( htmlPath, 'utf8' ) );
		const mobileHtmlPath = resolve( outputDir, entry.html.replace( /^html[\\/]/, 'html-mobile/' ) );
		if ( pathWithin( outputDir, mobileHtmlPath ) && existsSync( mobileHtmlPath ) ) {
			html = responsiveHtml( html, renderedHtml( readFileSync( mobileHtmlPath, 'utf8' ) ) );
		}
		retainedEntries.push( {
			url,
			html,
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
	const unresolvedMedia: Array< { url: string; error: string } > = [];
	const assets: Array< { sourceUrl: string; path: string } > = [];
	const mediaFamilies = new Map< string, MediaCandidate[] >();
	for ( const [ sourceUrl, stub ] of MediaStubStore.load( outputDir ).list() ) {
		const references = mediaReferences( sourceUrl, options.sourceUrl );
		if (
			stub.status === 'error' &&
			references.some( ( reference ) => containsMediaReference( retainedHtml, reference ) )
		) {
			for ( const reference of references )
				mediaReplacements.set( reference, TRANSPARENT_IMAGE_DATA_URL );
			unresolvedMedia.push( { url: sourceUrl, error: stub.error ?? 'media download failed' } );
			continue;
		}
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
	const copyingResources = new Set< string >();
	const resourceReplacements = new Map< string, string >();
	const copyResource = ( dependency: PortableDependency, sourceUrl: string ): boolean => {
		const resource = resourceManifest.resources[ dependency.url ];
		if ( ! resource ) {
			unresolvedDependencies.push( {
				url: dependency.url,
				sourceUrl,
				error: 'referenced same-origin dependency was not captured',
			} );
			return false;
		}
		const source = resolve( outputDir, resource.path );
		const relativePath = resource.path.replace( /^resources[\\/]/, '' );
		const destination = resolve( websiteDir, relativePath );
		const portablePath = `/${ relativePath.replace( /\\/g, '/' ) }`;
		resourceReplacements.set( dependency.reference, portablePath );
		resourceReplacements.set( dependency.url, portablePath );
		if ( copiedResources.has( resource.path ) ) return true;
		if ( copyingResources.has( resource.path ) ) return true;
		if (
			! pathWithin( outputDir, source ) ||
			! pathWithin( websiteDir, destination ) ||
			! existsSync( source )
		) {
			unresolvedDependencies.push( {
				url: dependency.url,
				sourceUrl,
				error: 'captured dependency file is unavailable',
			} );
			return false;
		}

		mkdirSync( dirname( destination ), { recursive: true } );
		copyingResources.add( resource.path );
		if ( /^(?:application\/json|text\/)/i.test( resource.contentType ) ) {
			let content = replaceAll( readFileSync( source, 'utf8' ), mediaReplacements );
			if ( /text\/css/i.test( resource.contentType ) ) {
				for ( const nested of dependencyReferences( content, dependency.url, options.sourceUrl ) ) {
					if ( ! copyResource( nested, dependency.url ) ) {
						content = replaceDanglingCssUrl( content, nested.reference );
					}
				}
			}
			writeFileSync( destination, replaceAll( content, resourceReplacements ) );
		} else {
			copyFileSync( source, destination );
		}
		copyingResources.delete( resource.path );
		copiedResources.add( resource.path );
		assets.push( {
			sourceUrl: dependency.url,
			path: `website/${ relativePath.replace( /\\/g, '/' ) }`,
		} );
		return true;
	};
	for ( const entry of retainedEntries ) {
		for ( const dependency of dependencyReferences( entry.html, entry.url, options.sourceUrl ) ) {
			if ( mediaReplacements.has( dependency.reference ) ) continue;
			if ( ! copyResource( dependency, entry.url ) ) {
				entry.html =
					dependency.kind === 'media'
						? removeDanglingMediaSource( entry.html, dependency.reference )
						: dependency.kind === 'css'
						? replaceDanglingCssUrl( entry.html, dependency.reference )
						: removeDanglingPreload( entry.html, dependency.reference );
			}
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
		writeFileSync(
			destination,
			replaceAll( replaceAll( html, mediaReplacements ), resourceReplacements )
		);
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
				unresolvedMedia,
				excludedRoutes,
			},
			null,
			2
		) }\n`
	);

	const artifactFiles: Array< {
		path: string;
		content?: string;
		content_base64?: string;
		encoding: 'utf8' | 'base64';
	} > = routes.map( ( route ) => {
		const relativePath = route.path.replace( /^website\//, '' );
		return {
			path: route.path,
			content: readFileSync( join( websiteDir, relativePath ), 'utf8' ),
			encoding: 'utf8',
		};
	} );
	for ( const asset of assets ) {
		const relativePath = asset.path.replace( /^website\//, '' );
		const content = readFileSync( join( websiteDir, relativePath ) );
		artifactFiles.push( {
			path: asset.path,
			content_base64: content.toString( 'base64' ),
			encoding: 'base64',
		} );
	}
	for ( const report of [ 'diagnostics.json', 'capture-receipt.json' ] ) {
		artifactFiles.push( {
			path: report,
			content: readFileSync( join( outputDir, report ), 'utf8' ),
			encoding: 'utf8',
		} );
	}
	const artifactPath = join( outputDir, 'artifact.json' );
	writeFileSync(
		artifactPath,
		`${ JSON.stringify(
			{
				schema: WEBSITE_ARTIFACT_SCHEMA,
				artifact_type: 'website',
				version: 1,
				compiler_limits: {
					max_file_bytes: 10 * 1024 * 1024,
				},
				id: `capture-${ Buffer.from( options.sourceUrl ).toString( 'base64url' ).slice( 0, 24 ) }`,
				generated_at: new Date().toISOString(),
				root: 'website',
				entrypoint: 'website/index.html',
				files: artifactFiles,
				provenance: {
					provider: 'data-liberation/browser-capture',
					source_url: options.sourceUrl,
					platform: options.platform,
					...( options.title ? { title: options.title } : {} ),
				},
				reports: [ 'diagnostics.json', 'capture-receipt.json' ],
			},
			null,
			2
		) }\n`
	);

	return receiptPath;
}
