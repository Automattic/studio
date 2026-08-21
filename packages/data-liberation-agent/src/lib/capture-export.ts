import {
	copyFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import * as cheerio from 'cheerio';
import { scopeCss } from './replicate/css-scope.js';
import { MediaStubStore } from './resume-state/index.js';
import { rewriteMediaUrls } from './streaming/media-url-rewrite.js';
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
	discoveryDiagnostics?: Array< { code: string; url: string; reason: string } >;
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
const MAX_PORTABLE_MEDIA_TOTAL_BYTES = 160 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 5000;
const MAX_ARTIFACT_TOTAL_BYTES = 192 * 1024 * 1024;
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

function rewriteCapturedRouteLinks(
	html: string,
	documentUrl: string,
	routes: Map< string, string >
): string {
	const $ = cheerio.load( html );
	$( 'a[href],area[href]' ).each( ( _index, element ) => {
		const link = $( element );
		const href = link.attr( 'href' ) ?? '';
		if ( ! /^(?:https?:)?\/\//i.test( href ) ) return;

		let resolved: URL;
		try {
			resolved = new URL( href, documentUrl );
		} catch {
			return;
		}
		const route = routes.get( normalizedUrl( resolved.href ) );
		if ( ! route ) return;
		link.attr( 'href', `${ route }${ resolved.search }${ resolved.hash }` );
	} );
	return $.html();
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
	const $ = cheerio.load( html.replace( /<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, '' ) );
	$( '*' ).each( ( _index, element ) => {
		const node = $( element );
		const style = node.attr( 'style' ) ?? '';
		if ( ! /(?:^|;)\s*position\s*:\s*fixed\s*!important/i.test( style ) ) return;
		const text = node.text().replace( /\s+/g, ' ' ).trim();
		const links = node
			.find( 'a[href]' )
			.map( ( _i, link ) => $( link ).attr( 'href' ) ?? '' )
			.get()
			.join( ' ' );
		if (
			! /\bpowered by\b|\bcreate your own (?:unique )?website\b/i.test( text ) ||
			! /\b(?:signup|get started)\b/i.test( `${ text } ${ links }` )
		)
			return;
		const height = /(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px\s*!important/i.exec( style )?.[ 1 ];
		const bodyStyle = $( 'body' ).attr( 'style' ) ?? '';
		if (
			height &&
			new RegExp( `(?:^|;)\\s*padding-bottom\\s*:\\s*${ height }px\\s*!important`, 'i' ).test(
				bodyStyle
			)
		) {
			$( 'body' ).attr(
				'style',
				bodyStyle
					.replace(
						new RegExp( `(?:^|;)\\s*padding-bottom\\s*:\\s*${ height }px\\s*!important`, 'i' ),
						''
					)
					.replace( /^\s*;|;\s*$/g, '' )
					.trim()
			);
		}
		node.remove();
	} );
	$( 'div,section,aside,footer' ).each( ( _index, element ) => {
		const node = $( element );
		const rendered = node.clone();
		rendered.find( 'script,style,noscript' ).remove();
		if (
			rendered.find( 'img,video,audio,iframe,form,input,button,a[href]' ).length > 0 ||
			rendered.text().trim() !== ''
		)
			return;
		if ( node.parents( 'main,article' ).length > 0 ) return;
		const style = node.attr( 'style' ) ?? '';
		const idAndClass = `${ node.attr( 'id' ) ?? '' } ${ node.attr( 'class' ) ?? '' }`;
		if (
			/(?:^|;)\s*(?:position\s*:\s*(?:fixed|absolute)|bottom\s*:)/i.test( style ) ||
			/(?:account.*app|app.*account|footer|modal|mount|portal|popup|toast)/i.test( idAndClass )
		) {
			node.remove();
		}
	} );
	const allLinks = $( 'body a[href]' )
		.map( ( _index, link ) => $( link ).attr( 'href' ) ?? '' )
		.get();
	$( 'body > div,body > nav' ).each( ( _index, element ) => {
		const node = $( element );
		const style = `${ node.attr( 'style' ) ?? '' };${
			node.children().first().attr( 'style' ) ?? ''
		}`;
		const links = node
			.find( 'a[href]' )
			.map( ( _i, link ) => $( link ).attr( 'href' ) ?? '' )
			.get();
		if ( links.length === 0 || ! /(?:^|;)\s*display\s*:\s*none/i.test( style ) ) return;
		if (
			links.every( ( href ) => allLinks.filter( ( candidate ) => candidate === href ).length > 1 )
		)
			node.remove();
	} );
	return $.html();
}

function openGraphUrl( html: string ): string | undefined {
	return cheerio.load( html )( 'meta[property="og:url"]' ).first().attr( 'content' );
}

const RESPONSIVE_DOCUMENT_CSS =
	'.data-liberation-mobile-document{display:none!important}@media(max-width:768px){.data-liberation-desktop-document{display:none!important}.data-liberation-mobile-document{display:contents!important}}';

function responsiveHtml( desktopHtml: string, mobileHtml: string ): string {
	const desktopBody = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec( desktopHtml )?.[ 1 ];
	const mobileBodyMatch = /<body\b([^>]*)>([\s\S]*?)<\/body\s*>/i.exec( mobileHtml );
	const mobileBody = mobileBodyMatch?.[ 2 ];
	if ( desktopBody === undefined || mobileBody === undefined ) return desktopHtml;
	if ( responsiveBodySignature( desktopBody ) === responsiveBodySignature( mobileBody ) )
		return desktopHtml;

	const mobileBodyClass = /\bclass\s*=\s*(["'])(.*?)\1/i.exec(
		mobileBodyMatch?.[ 1 ] ?? ''
	)?.[ 2 ];
	const mobileWrapperClass = [ 'data-liberation-mobile-document', mobileBodyClass ]
		.filter( Boolean )
		.join( ' ' );
	const responsiveBody = `<div class="data-liberation-desktop-document">${ desktopBody }</div><div class="${ mobileWrapperClass }">${ mobileBody }</div>`;
	const mobileStyles = responsiveMobileStyles( mobileHtml );
	return scopedStyles( desktopHtml, '(min-width:769px)' )
		.replace(
			/<\/head\s*>/i,
			`<style>${ RESPONSIVE_DOCUMENT_CSS }</style>${ mobileStyles }</head>`
		)
		.replace(
			/(<body\b[^>]*>)[\s\S]*?(<\/body\s*>)/i,
			( _match, openingBody: string, closingBody: string ) =>
				`${ openingBody }${ responsiveBody }${ closingBody }`
		);
}

function responsiveMobileStyles( mobileHtml: string ): string {
	return [ ...mobileHtml.matchAll( /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi ) ]
		.map( ( match ) => match[ 1 ].trim() )
		.filter( Boolean )
		.map(
			( style ) =>
				`<style media="(max-width:768px)">${ scopeCss( style, {
					scope: '.data-liberation-mobile-document',
				} ) }</style>`
		)
		.join( '' );
}

function scopedStyles( html: string, media: string ): string {
	return html.replace( /<style\b([^>]*)>/gi, ( tag, attributes: string ) => {
		const existingMedia = /\bmedia\s*=\s*(["'])(.*?)\1/i.exec( attributes );
		if ( ! existingMedia ) return `<style${ attributes } media="${ media }">`;
		const combined = `${ media } and (${ existingMedia[ 2 ] })`;
		return tag.replace(
			existingMedia[ 0 ],
			`media=${ existingMedia[ 1 ] }${ combined }${ existingMedia[ 1 ] }`
		);
	} );
}

function responsiveBodySignature( body: string ): string {
	const $ = cheerio.load( `<body>${ body }</body>` );
	$( 'script,style,noscript' ).remove();
	$( '*' ).each( ( _index, element ) => {
		const node = $( element );
		for ( const attribute of Object.keys( 'attribs' in element ? element.attribs : {} ) ) {
			if ( attribute === 'style' || attribute === 'class' ) {
				node.removeAttr( attribute );
			}
		}
		if ( node.is( 'img,source,video,audio' ) ) {
			node.removeAttr( 'src' ).removeAttr( 'srcset' ).removeAttr( 'sizes' );
		}
		if ( node.is( 'form,iframe' ) ) {
			for ( const attribute of [ 'id', 'name', 'target' ] ) {
				const value = node.attr( attribute );
				if ( value && /(?:target|frame)[-_]?\d{6,}$/i.test( value ) )
					node.attr( attribute, 'capture-target' );
			}
		}
	} );
	let removedEmptyMount = true;
	while ( removedEmptyMount ) {
		removedEmptyMount = false;
		$( 'div,span' ).each( ( _index, element ) => {
			const node = $( element );
			if (
				Object.keys( 'attribs' in element ? element.attribs : {} ).length === 0 &&
				node.children().length === 0 &&
				node.text().trim() === ''
			) {
				node.remove();
				removedEmptyMount = true;
			}
		} );
	}
	return ( $( 'body' ).html() ?? '' ).replace( />\s+</g, '><' ).replace( /\s+/g, ' ' ).trim();
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

function srcsetReferences( srcset: string ): string[] {
	const references: string[] = [];
	let offset = 0;
	while ( offset < srcset.length ) {
		while ( offset < srcset.length && /[\s,]/.test( srcset[ offset ] ) ) offset++;
		if ( offset >= srcset.length ) break;
		const start = offset;
		while ( offset < srcset.length && ! /\s/.test( srcset[ offset ] ) ) offset++;
		const reference = srcset.slice( start, offset ).replace( /,+$/, '' );
		if ( reference ) references.push( reference );
		while ( offset < srcset.length && srcset[ offset ] !== ',' ) offset++;
		if ( offset < srcset.length ) offset++;
	}
	return references;
}

function capturedMediaReferences(
	entries: Array< { url: string; html: string } >
): Map< string, Set< string > > {
	const families = new Map< string, Set< string > >();
	for ( const entry of entries ) {
		const references: string[] = [];
		for ( const match of entry.html.matchAll(
			/<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
		) ) {
			references.push( match[ 1 ] );
		}
		for ( const match of entry.html.matchAll(
			/<(?:img|source)\b[^>]*\bsrcset\s*=\s*["']([^"']+)["'][^>]*>/gi
		) ) {
			references.push( ...srcsetReferences( match[ 1 ] ) );
		}
		for ( const reference of references ) {
			try {
				const family = mediaFamily( new URL( reference.replace( /&amp;/g, '&' ), entry.url ).href );
				families.set( family, new Set( [ ...( families.get( family ) ?? [] ), reference ] ) );
			} catch {
				// Ignore non-URL browser values such as data URIs and malformed placeholders.
			}
		}
	}
	return families;
}

function mediaFamily( sourceUrl: string ): string {
	const url = new URL( sourceUrl );
	const transformedPath = /^(.*?)\/v1\/(?:fill|fit|crop)\//i.exec( url.pathname )?.[ 1 ];
	if ( transformedPath ) return `${ url.origin }${ transformedPath }`;
	const parameters = [ ...url.searchParams.keys() ];
	return parameters.length > 0 && parameters.every( ( key ) => key === 'w' || key === 'h' )
		? `${ url.origin }${ url.pathname }`
		: sourceUrl;
}

function retainedMediaReferencesByFamily(
	entries: Array< { url: string; html: string } >
): Map< string, string[] > {
	const families = new Map< string, string[] >();
	const add = ( reference: string, documentUrl: string ) => {
		try {
			const family = mediaFamily( new URL( reference.replace( /&amp;/g, '&' ), documentUrl ).href );
			families.set( family, [
				...( families.get( family ) ?? [] ),
				reference.replace( /&amp;/g, '&' ),
			] );
		} catch {
			// Non-URL media sources, such as data URLs, need no localization.
		}
	};
	for ( const { url, html } of entries ) {
		const $ = cheerio.load( html );
		$( 'img,source,video,audio' ).each( ( _index, element ) => {
			const node = $( element );
			const src = node.attr( 'src' );
			if ( src ) add( src, url );
			const srcset = node.attr( 'srcset' );
			if ( ! srcset ) return;
			const urls =
				srcset.match( /https?:\/\/[^\s"'<>]+/g ) ??
				srcset.split( ',' ).map( ( value ) => value.trim().split( /\s+/, 1 )[ 0 ] );
			for ( const candidate of urls ) if ( candidate ) add( candidate, url );
		} );
	}
	return families;
}

function mediaDimension( sourceUrl: string ): number {
	const url = new URL( sourceUrl );
	const finalTransformation = [
		...url.pathname.matchAll( /\/v1\/(?:fill|fit|crop)\/([^/]+)/gi ),
	].at( -1 )?.[ 1 ];
	const pathDimensions = [
		...( finalTransformation ?? url.pathname ).matchAll( /(?:^|[,/])(?:w|h)_(\d+)/gi ),
	].map( ( match ) => Number( match[ 1 ] ) || 0 );
	return Math.max(
		Number( url.searchParams.get( 'w' ) ) || 0,
		Number( url.searchParams.get( 'h' ) ) || 0,
		...pathDimensions
	);
}

function selectMediaCandidate( candidates: MediaCandidate[] ): MediaCandidate | undefined {
	const bounded = candidates.filter(
		( candidate ) =>
			candidate.bytes <= MAX_PORTABLE_MEDIA_BYTES &&
			candidate.dimension <= MAX_PORTABLE_MEDIA_DIMENSION
	);
	return [ ...bounded ].sort(
		( a, b ) =>
			b.dimension - a.dimension || a.bytes - b.bytes || a.sourceUrl.localeCompare( b.sourceUrl )
	)[ 0 ];
}

function portableMediaBasename( candidate: MediaCandidate ): string {
	const localName = basename( candidate.localPath );
	if (
		/^\.(?:avif|gif|jpe?g|png|svg|webp|mp4|webm|mp3|ogg|wav|woff2?|ttf|otf)$/i.test(
			extname( localName )
		)
	) {
		return localName;
	}

	const cleanedUrl = candidate.sourceUrl.replace( /&(?:quot|apos|amp);?$/i, '' );
	const sourceExtension = extname( basename( new URL( cleanedUrl ).pathname ) );
	if (
		! /^\.(?:avif|gif|jpe?g|png|svg|webp|mp4|webm|mp3|ogg|wav|woff2?|ttf|otf)$/i.test(
			sourceExtension
		)
	) {
		return localName;
	}
	return `${ localName.slice(
		0,
		localName.length - extname( localName ).length
	) }${ sourceExtension.toLowerCase() }`;
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
	siteUrl: string,
	cssOnly = false
): PortableDependency[] {
	const searchableHtml = html
		.replace( /&quot;|&#34;|&#x22;/gi, '"' )
		.replace( /&apos;|&#39;|&#x27;/gi, "'" );
	let cssContent = searchableHtml;
	if ( ! cssOnly ) {
		const $ = cheerio.load( html );
		cssContent = [
			...$( 'style' )
				.map( ( _index, element ) => $( element ).html() ?? '' )
				.get(),
			...$( '[style]' )
				.map( ( _index, element ) => $( element ).attr( 'style' ) ?? '' )
				.get(),
		]
			.join( '\n' )
			.replace( /&quot;|&#34;|&#x22;/gi, '"' )
			.replace( /&apos;|&#39;|&#x27;/gi, "'" );
	}
	const references = new Set< string >();
	const add = ( reference: string | undefined ) => {
		if ( reference ) references.add( reference.replace( /&amp;/g, '&' ) );
	};

	for ( const match of searchableHtml.matchAll(
		/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
	) ) {
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
		for ( const reference of srcsetReferences( match[ 1 ] ) ) {
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
	for ( const match of searchableHtml.matchAll(
		/\bimport\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g
	) ) {
		add( match[ 1 ] );
	}
	for ( const match of cssContent.matchAll(
		/\burl\(\s*(?:["']([^"']+)["']|([^\s)'";]+))\s*\)/gi
	) ) {
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

function removeDanglingResourceReference( html: string, reference: string ): string {
	const normalizedReference = reference.replace( /&amp;/g, '&' );
	const $ = cheerio.load( html );
	$( 'link' ).each( ( _, element ) => {
		const link = $( element );
		const relations = ( link.attr( 'rel' ) ?? '' ).toLowerCase().split( /\s+/ );
		const href = ( link.attr( 'href' ) ?? '' ).replace( /&amp;/g, '&' );
		if (
			href === normalizedReference &&
			( relations.includes( 'preload' ) || relations.includes( 'modulepreload' ) )
		) {
			link.remove();
		}
	} );
	$( 'script' ).each( ( _, element ) => {
		const script = $( element );
		const src = ( script.attr( 'src' ) ?? '' ).replace( /&amp;/g, '&' );
		if ( src === normalizedReference ) script.remove();
	} );
	return $.html();
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
			canonicalUrl: entry.metadata?.openGraph?.[ 'og:url' ] ?? openGraphUrl( html ),
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
	const renderedMediaReferences = capturedMediaReferences( retainedEntries );
	const mediaFamilies = new Map< string, MediaCandidate[] >();
	const retainedMediaFamilies = retainedMediaReferencesByFamily( retainedEntries );
	const failedMedia: Array< { sourceUrl: string; error: string; references: string[] } > = [];
	for ( const [ sourceUrl, stub ] of MediaStubStore.load( outputDir ).list() ) {
		const references = mediaReferences( sourceUrl, options.sourceUrl );
		const family = mediaFamily( sourceUrl );
		const isReferenced =
			retainedMediaFamilies.has( family ) ||
			references.some( ( reference ) => containsMediaReference( retainedHtml, reference ) );
		if ( stub.status === 'error' && isReferenced ) {
			failedMedia.push( { sourceUrl, error: stub.error ?? 'media download failed', references } );
			continue;
		}
		if (
			stub.status !== 'success' ||
			! stub.localPath ||
			! existsSync( stub.localPath ) ||
			! isReferenced
		)
			continue;
		const candidate: MediaCandidate = {
			sourceUrl,
			localPath: stub.localPath,
			references: [
				...new Set( [ ...references, ...( renderedMediaReferences.get( family ) ?? [] ) ] ),
			],
			bytes: statSync( stub.localPath ).size,
			dimension: mediaDimension( sourceUrl ),
		};
		mediaFamilies.set( family, [ ...( mediaFamilies.get( family ) ?? [] ), candidate ] );
	}
	const portableMediaCandidates = [ ...mediaFamilies.values() ]
		.map( ( candidates ) => ( { candidates, selected: selectMediaCandidate( candidates ) } ) )
		.sort( ( left, right ) => {
			const leftEntrypoint = left.candidates.some( ( candidate ) =>
				candidate.references.some( ( reference ) =>
					containsMediaReference( entrypointCandidates[ 0 ].html, reference )
				)
			);
			const rightEntrypoint = right.candidates.some( ( candidate ) =>
				candidate.references.some( ( reference ) =>
					containsMediaReference( entrypointCandidates[ 0 ].html, reference )
				)
			);
			return (
				Number( rightEntrypoint ) - Number( leftEntrypoint ) ||
				( left.selected?.bytes ?? 0 ) - ( right.selected?.bytes ?? 0 ) ||
				( left.selected?.sourceUrl ?? '' ).localeCompare( right.selected?.sourceUrl ?? '' )
			);
		} );
	const selectedPortableMedia = new Set< MediaCandidate >();
	let portableMediaBytes = 0;
	for ( const { selected } of portableMediaCandidates ) {
		if ( selected && portableMediaBytes + selected.bytes <= MAX_PORTABLE_MEDIA_TOTAL_BYTES ) {
			selectedPortableMedia.add( selected );
			portableMediaBytes += selected.bytes;
		}
	}
	let retainedExternalMediaCount = 0;
	const localizedMediaFamilies = new Set< string >();
	for ( const candidates of mediaFamilies.values() ) {
		const family = mediaFamily( candidates[ 0 ].sourceUrl );
		const selected = selectMediaCandidate( candidates );
		if ( ! selected ) {
			for ( const reference of retainedMediaFamilies.get( family ) ?? [] )
				mediaReplacements.set( reference, candidates[ 0 ].sourceUrl );
			for ( const candidate of candidates ) {
				for ( const reference of candidate.references ) {
					mediaReplacements.set( reference, candidate.sourceUrl );
				}
				unresolvedMedia.push( {
					url: candidate.sourceUrl,
					error:
						'retained as an external URL because media exceeds portable size or dimension limits',
				} );
				retainedExternalMediaCount++;
			}
			continue;
		}
		if ( ! selectedPortableMedia.has( selected ) ) {
			for ( const candidate of candidates ) {
				for ( const reference of candidate.references ) {
					mediaReplacements.set( reference, selected.sourceUrl );
				}
			}
			unresolvedMedia.push( {
				url: selected.sourceUrl,
				error: 'retained as an external URL because the aggregate portable media limit was reached',
			} );
			retainedExternalMediaCount++;
			continue;
		}
		const assetPath = join( 'media', portableMediaBasename( selected ) );
		const destination = join( websiteDir, assetPath );
		mkdirSync( dirname( destination ), { recursive: true } );
		copyFileSync( selected.localPath, destination );
		localizedMediaFamilies.add( family );
		for ( const reference of retainedMediaFamilies.get( family ) ?? [] )
			mediaReplacements.set( reference, `/${ assetPath.replace( /\\/g, '/' ) }` );
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
	const portableMedia = {
		selected_count: assets.length,
		selected_bytes: portableMediaBytes,
		retained_external_count: retainedExternalMediaCount,
		max_bytes: MAX_PORTABLE_MEDIA_TOTAL_BYTES,
	};
	for ( const { sourceUrl, error, references } of failedMedia ) {
		const family = mediaFamily( sourceUrl );
		if ( localizedMediaFamilies.has( family ) ) continue;
		for ( const reference of retainedMediaFamilies.get( family ) ?? [] )
			mediaReplacements.set( reference, TRANSPARENT_IMAGE_DATA_URL );
		for ( const reference of references )
			mediaReplacements.set( reference, TRANSPARENT_IMAGE_DATA_URL );
		unresolvedMedia.push( { url: sourceUrl, error } );
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
				for ( const nested of dependencyReferences(
					content,
					dependency.url,
					options.sourceUrl,
					true
				) ) {
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
						: removeDanglingResourceReference( entry.html, dependency.reference );
			}
		}
	}

	const routes: Array< { url: string; path: string } > = [];
	const portableRouteLinks = new Map< string, string >();
	const claimedPaths = new Set< string >();
	for ( const { url, canonicalUrl } of retainedEntries ) {
		const routePath = routeOutputPath( url, options.sourceUrl, entrypointUrl ).replace(
			/\\/g,
			'/'
		);
		if ( claimedPaths.has( routePath ) ) {
			throw new Error( `Captured routes resolve to the same website path: ${ routePath }` );
		}
		claimedPaths.add( routePath );
		const portablePath = `/${ routePath }`;
		portableRouteLinks.set( normalizedUrl( url ), portablePath );
		if ( canonicalUrl ) portableRouteLinks.set( normalizedUrl( canonicalUrl ), portablePath );
		routes.push( { url, path: `website/${ routePath }` } );
	}

	for ( const { url, html } of retainedEntries ) {
		const routePath = routeOutputPath( url, options.sourceUrl, entrypointUrl ).replace(
			/\\/g,
			'/'
		);
		const destination = join( websiteDir, routePath );
		if ( ! pathWithin( websiteDir, destination ) ) {
			throw new Error( `Captured route escapes the website directory: ${ url }` );
		}
		mkdirSync( dirname( destination ), { recursive: true } );
		writeFileSync(
			destination,
			replaceAll(
				rewriteMediaUrls(
					rewriteCapturedRouteLinks( html, url, portableRouteLinks ),
					mediaReplacements
				),
				resourceReplacements
			)
		);
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
				portableMedia,
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
				discoveryDiagnostics: options.discoveryDiagnostics ?? [],
				resourceFailures: resourceManifest.failures,
				unresolvedDependencies,
				unresolvedMedia,
				portableMedia,
				excludedRoutes,
			},
			null,
			2
		) }\n`
	);

	const artifactPath = join( outputDir, 'artifact.json' );
	const artifactTempPath = `${ artifactPath }.tmp`;
	let artifactFd: number | undefined;
	try {
		artifactFd = openSync( artifactTempPath, 'w' );
		writeFileSync(
			artifactFd,
			`${ JSON.stringify( {
				schema: WEBSITE_ARTIFACT_SCHEMA,
				artifact_type: 'website',
				version: 1,
				compiler_limits: {
					max_files: MAX_ARTIFACT_FILES,
					max_file_bytes: 10 * 1024 * 1024,
					max_total_bytes: MAX_ARTIFACT_TOTAL_BYTES,
				},
				id: `capture-${ Buffer.from( options.sourceUrl ).toString( 'base64url' ).slice( 0, 24 ) }`,
				generated_at: new Date().toISOString(),
				root: 'website',
				entrypoint: 'website/index.html',
			} ).slice( 0, -1 ) },"files":[`
		);

		let firstFile = true;
		let artifactFileCount = 0;
		let artifactContentBytes = 0;
		const writeArtifactFile = ( file: Record< string, string >, contentBytes: number ) => {
			artifactFileCount++;
			artifactContentBytes += contentBytes;
			if (
				artifactFileCount > MAX_ARTIFACT_FILES ||
				artifactContentBytes > MAX_ARTIFACT_TOTAL_BYTES
			) {
				throw new Error(
					`Portable capture exceeds compiler limits: ${ artifactFileCount } files, ${ artifactContentBytes } bytes.`
				);
			}
			writeFileSync( artifactFd!, `${ firstFile ? '' : ',' }${ JSON.stringify( file ) }` );
			firstFile = false;
		};
		const orderedRoutes = [ ...routes ].sort( ( left, right ) =>
			left.path === 'website/index.html' ? -1 : right.path === 'website/index.html' ? 1 : 0
		);
		for ( const route of orderedRoutes ) {
			const relativePath = route.path.replace( /^website\//, '' );
			const content = readFileSync( join( websiteDir, relativePath ), 'utf8' );
			writeArtifactFile(
				{
					path: route.path,
					content,
					encoding: 'utf8',
				},
				Buffer.byteLength( content )
			);
		}
		for ( const asset of assets ) {
			const relativePath = asset.path.replace( /^website\//, '' );
			const content = readFileSync( join( websiteDir, relativePath ) );
			writeArtifactFile(
				{
					path: asset.path,
					content_base64: content.toString( 'base64' ),
					encoding: 'base64',
				},
				content.length
			);
		}
		for ( const report of [ 'diagnostics.json', 'capture-receipt.json' ] ) {
			const content = readFileSync( join( outputDir, report ), 'utf8' );
			writeArtifactFile(
				{
					path: report,
					content,
					encoding: 'utf8',
				},
				Buffer.byteLength( content )
			);
		}
		writeFileSync(
			artifactFd,
			`],"provenance":${ JSON.stringify( {
				provider: 'data-liberation/browser-capture',
				source_url: options.sourceUrl,
				platform: options.platform,
				...( options.title ? { title: options.title } : {} ),
			} ) },"reports":["diagnostics.json","capture-receipt.json"]}\n`
		);
		closeSync( artifactFd );
		artifactFd = undefined;
		renameSync( artifactTempPath, artifactPath );
	} catch ( error ) {
		if ( artifactFd !== undefined ) closeSync( artifactFd );
		rmSync( artifactTempPath, { force: true } );
		throw error;
	}

	return receiptPath;
}
