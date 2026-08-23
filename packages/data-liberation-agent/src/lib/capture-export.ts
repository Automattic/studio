import { createHash } from 'node:crypto';
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
import { escapeHtmlAttr } from './html-escape.js';
import { scopeCss } from './replicate/css-scope.js';
import { MediaStubStore } from './resume-state/index.js';
import {
	buildLayoutGeometryProof,
	type GeometryCapture,
} from './screenshot/layout-geometry-proof.js';
import { rewriteMediaUrls } from './streaming/media-url-rewrite.js';
import type { InteractionStatesReport } from './screenshot/interaction-capture.js';
import type { CapturedResourceManifest } from './screenshot/resource-capture.js';

export const CAPTURE_RECEIPT_SCHEMA = 'data-liberation/capture-receipt/v1';
export const WEBSITE_ARTIFACT_SCHEMA = 'blocks-engine/php-transformer/site-artifact/v1';
export const CAPTURED_INTERACTIONS_SCHEMA = 'data-liberation/captured-interactions/v1';

function withoutGeometryIdentities( html: string ): string {
	return html.replace( /\sdata-dla-geometry-id=(?:"[^"]*"|'[^']*')/g, '' );
}

interface CaptureManifestEntry {
	slug?: string;
	html?: string;
	sections?: string;
	interactions?: InteractionStatesReport;
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

interface RetainedCaptureEntry {
	slug: string;
	url: string;
	html: string;
	desktopHtml: string;
	mobileHtml?: string;
	sections?: string;
	canonicalUrl?: string;
}

function fileHash( path: string ): string {
	return createHash( 'sha256' ).update( readFileSync( path ) ).digest( 'hex' );
}

function uniqueAssetPath(
	requestedPath: string,
	contentHash: string,
	hashesByPath: Map< string, string >
): string {
	const existingHash = hashesByPath.get( requestedPath );
	if ( existingHash === undefined || existingHash === contentHash ) return requestedPath;
	const extension = extname( requestedPath );
	return `${ requestedPath.slice(
		0,
		requestedPath.length - extension.length
	) }-${ contentHash.slice( 0, 12 ) }${ extension }`;
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
	$( 'img[src],img[srcset]' ).each( ( _index, element ) => {
		const node = $( element );
		const source = `${ node.attr( 'src' ) ?? '' },${ node.attr( 'srcset' ) ?? '' }`;
		const alignment = /(?:^|[,/])al_(tl|tc|tr|bl|bc|br|t|b|l|c|r)(?=[,/]|$)/i
			.exec( source )?.[ 1 ]
			?.toLowerCase();
		if ( ! alignment ) return;
		const positions: Record< string, string > = {
			tl: 'left top',
			tc: 'center top',
			tr: 'right top',
			bl: 'left bottom',
			bc: 'center bottom',
			br: 'right bottom',
			t: 'center top',
			b: 'center bottom',
			l: 'left center',
			c: 'center center',
			r: 'right center',
		};
		const style = node.attr( 'style' ) ?? '';
		if ( /(?:^|;)\s*object-position\s*:/i.test( style ) ) return;
		const prefix = style.trim() ? style.trim().replace( /;?$/, ';' ) : '';
		node.attr( 'style', `${ prefix }object-position:${ positions[ alignment ] }` );
	} );
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
	'html,body{margin:0;padding:0}.data-liberation-mobile-document{display:none!important}@media(max-width:768px){.data-liberation-desktop-document{display:none!important}.data-liberation-mobile-document{display:contents!important}}';

function responsiveHtml( desktopHtml: string, mobileHtml: string ): string {
	const desktopBodyMatch = /<body\b([^>]*)>([\s\S]*?)<\/body\s*>/i.exec( desktopHtml );
	const desktopBody = desktopBodyMatch?.[ 2 ];
	const mobileBodyMatch = /<body\b([^>]*)>([\s\S]*?)<\/body\s*>/i.exec( mobileHtml );
	const mobileBody = mobileBodyMatch?.[ 2 ];
	if ( desktopBody === undefined || mobileBody === undefined ) return desktopHtml;
	const mobileViewport = /<meta\b[^>]*\bname\s*=\s*(["'])viewport\1[^>]*>/i.exec(
		mobileHtml
	)?.[ 0 ];
	const withMobileViewport = ( html: string ): string => {
		if ( ! mobileViewport ) return html;
		return /<meta\b[^>]*\bname\s*=\s*(["'])viewport\1[^>]*>/i.test( html )
			? html.replace( /<meta\b[^>]*\bname\s*=\s*(["'])viewport\1[^>]*>/i, mobileViewport )
			: html.replace( /<\/head\s*>/i, `${ mobileViewport }</head>` );
	};
	if ( responsiveBodySignature( desktopBody ) === responsiveBodySignature( mobileBody ) )
		return withMobileViewport( desktopHtml );

	const wrapperAttributes = ( baseClass: string, bodyAttributes: string ): string => {
		const body = cheerio.load( `<body${ bodyAttributes }></body>` )( 'body' );
		const className = [ baseClass, body.attr( 'class' ) ].filter( Boolean ).join( ' ' );
		const style = body.attr( 'style' );
		return `class="${ escapeHtmlAttr( className ) }"${
			style ? ` style="${ escapeHtmlAttr( style ) }"` : ''
		}`;
	};
	const responsiveBody = `<div ${ wrapperAttributes(
		'data-liberation-desktop-document',
		desktopBodyMatch?.[ 1 ] ?? ''
	) }>${ desktopBody }</div><div ${ wrapperAttributes(
		'data-liberation-mobile-document',
		mobileBodyMatch?.[ 1 ] ?? ''
	) }>${ mobileBody }</div>`;
	const sharedStyles = styleBlocks( desktopHtml );
	if (
		sharedStyles.length > 0 &&
		sharedStyles.join( '\n' ) === styleBlocks( mobileHtml ).join( '\n' )
	) {
		return withMobileViewport( desktopHtml )
			.replace( /<\/head\s*>/i, `<style>${ RESPONSIVE_DOCUMENT_CSS }</style></head>` )
			.replace(
				/<body\b[^>]*>[\s\S]*?(<\/body\s*>)/i,
				( _match, closingBody: string ) => `<body>${ responsiveBody }${ closingBody }`
			);
	}
	const mobileStyles = responsiveMobileStyles( mobileHtml );
	return withMobileViewport( scopedStyles( desktopHtml, '(min-width:769px)' ) )
		.replace(
			/<\/head\s*>/i,
			`<style>${ RESPONSIVE_DOCUMENT_CSS }</style>${ mobileStyles }</head>`
		)
		.replace(
			/<body\b[^>]*>[\s\S]*?(<\/body\s*>)/i,
			( _match, closingBody: string ) => `<body>${ responsiveBody }${ closingBody }`
		);
}

function styleBlocks( html: string ): string[] {
	return [ ...html.matchAll( /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi ) ].map( ( match ) =>
		match[ 1 ].trim()
	);
}

export function portableInlineStyle(
	attributes: string,
	css: string
): { key: string; media: string } | undefined {
	const mediaMatch = /\bmedia\s*=\s*(["'])(.*?)\1/i.exec( attributes );
	const unsupportedAttributes = attributes
		.replace( /\btype\s*=\s*(["']).*?\1/gi, '' )
		.replace( /\bmedia\s*=\s*(["']).*?\1/gi, '' )
		.trim();
	return portableInlineStyleValues( mediaMatch?.[ 2 ] ?? '', unsupportedAttributes !== '', css );
}

function portableInlineStyleValues(
	media: string,
	hasUnsupportedAttributes: boolean,
	css: string
): { key: string; media: string } | undefined {
	if ( hasUnsupportedAttributes || css.trim() === '' || /(?:url\s*\(|@import)/i.test( css ) )
		return undefined;
	// eslint-disable-next-line no-control-regex -- reject unprintable media attributes.
	if ( /[\u0000-\u001f\u007f<>&]/.test( media ) ) return undefined;
	return { key: `${ media }\n${ css }`, media };
}

function responsiveMobileStyles( mobileHtml: string ): string {
	return styleBlocks( mobileHtml )
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
	$( 'canvas' ).removeAttr( 'width' ).removeAttr( 'height' );
	$( '[id]' ).each( ( _index, element ) => {
		$( element )
			.contents()
			.each( ( _childIndex, child ) => {
				if ( child.type === 'text' ) child.data = '';
			} );
	} );
	$( '*' )
		.contents()
		.each( ( _index, child ) => {
			if ( child.type === 'comment' ) $( child ).remove();
		} );
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

function portableResourcePath( path: string, contentType: string ): string | undefined {
	const requestedPath = path.replace( /^resources[\\/]/, '' );
	if ( extname( basename( requestedPath ) ) ) return requestedPath;

	const extension =
		{
			'application/ecmascript': '.js',
			'application/javascript': '.js',
			'application/json': '.json',
			'application/ld+json': '.json',
			'application/pdf': '.pdf',
			'application/xml': '.xml',
			'application/wasm': '.wasm',
			'audio/mpeg': '.mp3',
			'audio/ogg': '.ogg',
			'audio/wav': '.wav',
			'font/otf': '.otf',
			'font/ttf': '.ttf',
			'font/woff': '.woff',
			'font/woff2': '.woff2',
			'image/avif': '.avif',
			'image/gif': '.gif',
			'image/jpeg': '.jpg',
			'image/png': '.png',
			'image/svg+xml': '.svg',
			'image/webp': '.webp',
			'text/css': '.css',
			'text/ecmascript': '.js',
			'text/html': '.html',
			'text/javascript': '.js',
			'text/plain': '.txt',
			'text/xml': '.xml',
			'video/mp4': '.mp4',
			'video/ogg': '.ogg',
			'video/webm': '.webm',
		}[ contentType.toLowerCase().split( ';', 1 )[ 0 ].trim() ] ?? '';

	return extension ? `${ requestedPath }${ extension }` : undefined;
}

function dependencyReferences(
	html: string,
	documentUrl: string,
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

	const mediaReferences = new Set< string >();
	const cssReferences = new Set< string >();
	for ( const match of searchableHtml.matchAll(
		/<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
	) ) {
		mediaReferences.add( match[ 1 ].replace( /&amp;/g, '&' ) );
		add( match[ 1 ] );
	}
	for ( const match of searchableHtml.matchAll(
		/<video\b[^>]*\bposter\s*=\s*["']([^"']+)["'][^>]*>/gi
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
		const relations = rel.split( /\s+/ );
		if (
			relations.some( ( value ) => value === 'stylesheet' || /(?:^|-)icon$/.test( value ) ) ||
			( relations.includes( 'preload' ) && [ 'style', 'font', 'image', 'media' ].includes( as ) )
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
		if ( reference && ! reference.startsWith( 'data:' ) && ! reference.startsWith( '#' ) ) {
			cssReferences.add( reference.replace( /&amp;/g, '&' ) );
			add( reference );
		}
	}
	for ( const match of cssContent.matchAll( /@import\s+(?:url\(\s*)?["']([^"']+)["']/gi ) ) {
		const reference = match[ 1 ];
		cssReferences.add( reference.replace( /&amp;/g, '&' ) );
		add( reference );
	}

	return [ ...references ].flatMap( ( reference ) => {
		try {
			const url = new URL( reference, documentUrl );
			return [
				{
					reference,
					url: url.href,
					kind: mediaReferences.has( reference )
						? 'media'
						: cssReferences.has( reference )
						? 'css'
						: 'resource',
				},
			];
		} catch {
			return [];
		}
	} );
}

function removeDanglingMediaSource( html: string, reference: string ): string {
	const normalizedReference = reference.replace( /&amp;/g, '&' );
	const withoutSources = html.replace( /<(img|source|video|audio)\b[^>]*>/gi, ( tag ) => {
		const element = /^<(\w+)/.exec( tag )?.[ 1 ].toLowerCase();
		const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec( tag )?.[ 1 ].replace( /&amp;/g, '&' );
		return src === normalizedReference
			? element === 'img'
				? tag.replace( /\s+src\s*=\s*["'][^"']*["']/i, ` src="${ TRANSPARENT_IMAGE_DATA_URL }"` )
				: tag.replace( /\s+src\s*=\s*["'][^"']*["']/i, '' )
			: tag;
	} );
	return replaceAll(
		withoutSources,
		new Map( [
			[ reference, TRANSPARENT_IMAGE_DATA_URL ],
			[ normalizedReference, TRANSPARENT_IMAGE_DATA_URL ],
		] )
	);
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
			( relations.includes( 'preload' ) ||
				relations.includes( 'stylesheet' ) ||
				relations.some( ( value ) => /(?:^|-)icon$/.test( value ) ) )
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

function safeCapturedPageHtml( html: string ): string {
	const $ = cheerio.load( html );
	// Preserve rendered structure and author CSS, but never ship executable provider runtime.
	$( 'script,noscript,iframe,object,embed,base' ).remove();
	$( 'meta[http-equiv]' ).each( ( _index, element ) => {
		if ( ( $( element ).attr( 'http-equiv' ) ?? '' ).toLowerCase() === 'refresh' ) {
			$( element ).remove();
		}
	} );
	$( '*' ).each( ( _index, element ) => {
		const node = $( element );
		for ( const [ attribute, rawValue ] of Object.entries(
			'attribs' in element ? element.attribs : {}
		) ) {
			const value = [ ...rawValue ]
				.filter( ( character ) => character.charCodeAt( 0 ) > 0x20 )
				.join( '' )
				.toLowerCase();
			if (
				/^on/i.test( attribute ) ||
				attribute.toLowerCase() === 'srcdoc' ||
				[ 'action', 'formaction' ].includes( attribute.toLowerCase() ) ||
				( [ 'href', 'src', 'xlink:href' ].includes( attribute.toLowerCase() ) &&
					/^(?:javascript|vbscript|data:text\/html)/.test( value ) ) ||
				( attribute.toLowerCase() === 'style' &&
					/(?:expression\s*\(|-moz-binding|url\s*\(\s*["']?\s*(?:javascript|vbscript|data:text\/html))/i.test(
						rawValue
					) )
			) {
				node.removeAttr( attribute );
			}
		}
	} );
	$( 'link' ).each( ( _index, element ) => {
		const node = $( element );
		const rel = ( node.attr( 'rel' ) ?? '' ).toLowerCase().split( /\s+/ );
		const as = ( node.attr( 'as' ) ?? '' ).toLowerCase();
		if (
			rel.includes( 'modulepreload' ) ||
			( rel.includes( 'preload' ) && [ 'script', 'fetch' ].includes( as ) )
		)
			node.remove();
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

	const retainedEntries: RetainedCaptureEntry[] = [];
	const interactionPages: InteractionStatesReport[] = [];
	const excludedRoutes: string[] = [];
	for ( const [ url, entry ] of Object.entries( capture.entries ) ) {
		if ( ! routeInSourceScope( url, options.sourceUrl ) ) {
			excludedRoutes.push( url );
			continue;
		}
		if ( ! entry.html ) continue;
		const htmlPath = resolve( outputDir, entry.html );
		if ( ! pathWithin( outputDir, htmlPath ) || ! existsSync( htmlPath ) ) continue;
		const desktopHtml = renderedHtml( readFileSync( htmlPath, 'utf8' ) );
		let html = desktopHtml;
		let mobileHtml: string | undefined;
		const mobileHtmlPath = resolve( outputDir, entry.html.replace( /^html[\\/]/, 'html-mobile/' ) );
		if ( pathWithin( outputDir, mobileHtmlPath ) && existsSync( mobileHtmlPath ) ) {
			mobileHtml = renderedHtml( readFileSync( mobileHtmlPath, 'utf8' ) );
			html = responsiveHtml( html, mobileHtml );
		}
		retainedEntries.push( {
			slug: entry.slug ?? basename( entry.html, '.html' ),
			url,
			html,
			desktopHtml,
			mobileHtml,
			sections: entry.sections,
			canonicalUrl: entry.metadata?.openGraph?.[ 'og:url' ] ?? openGraphUrl( html ),
		} );
		if ( entry.interactions?.schema === 'data-liberation/interaction-states/v1' ) {
			interactionPages.push( entry.interactions );
		}
	}

	const normalizedSourceUrl = normalizedUrl( options.sourceUrl );
	const exactEntrypointCandidates = retainedEntries.filter(
		( { url } ) => normalizedUrl( url ) === normalizedSourceUrl
	);
	const entrypointCandidates =
		exactEntrypointCandidates.length > 0
			? exactEntrypointCandidates
			: retainedEntries.filter(
					( { canonicalUrl } ) =>
						canonicalUrl !== undefined && normalizedUrl( canonicalUrl ) === normalizedSourceUrl
			  );
	if ( entrypointCandidates.length !== 1 ) {
		throw new Error(
			`Capture does not identify one rendered homepage for the source URL: ${ options.sourceUrl }`
		);
	}
	const entrypointUrl = entrypointCandidates[ 0 ].url;
	const capturedRouteByReference = new Map< string, string >();
	for ( const entry of retainedEntries ) {
		const route = normalizedUrl( entry.url );
		capturedRouteByReference.set( route, route );
		if ( entry.canonicalUrl )
			capturedRouteByReference.set( normalizedUrl( entry.canonicalUrl ), route );
	}
	const routeLinks = new Map< string, Set< string > >();
	for ( const entry of retainedEntries ) {
		const $ = cheerio.load( entry.html );
		const links = new Set< string >();
		$( 'a[href]' ).each( ( _index, element ) => {
			try {
				const linkedUrl = new URL( $( element ).attr( 'href' )!, entry.url );
				const linkedRoute = capturedRouteByReference.get( normalizedUrl( linkedUrl.href ) );
				if ( linkedRoute ) links.add( linkedRoute );
			} catch {
				// Invalid browser references are handled by dependency validation below.
			}
		} );
		routeLinks.set( normalizedUrl( entry.url ), links );
	}
	const reachableRoutes = new Set< string >();
	const routeQueue = [ normalizedUrl( entrypointUrl ) ];
	while ( routeQueue.length > 0 ) {
		const route = routeQueue.shift()!;
		if ( reachableRoutes.has( route ) ) continue;
		reachableRoutes.add( route );
		for ( const linkedRoute of routeLinks.get( route ) ?? [] ) {
			if ( ! reachableRoutes.has( linkedRoute ) ) routeQueue.push( linkedRoute );
		}
	}
	const reachableEntries = retainedEntries.filter( ( entry ) =>
		reachableRoutes.has( normalizedUrl( entry.url ) )
	);
	for ( const entry of retainedEntries ) {
		if ( ! reachableEntries.includes( entry ) ) excludedRoutes.push( entry.url );
	}
	retainedEntries.splice( 0, retainedEntries.length, ...reachableEntries );
	for ( const entry of retainedEntries ) entry.html = safeCapturedPageHtml( entry.html );

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
	const portableMediaHashes = new Set< string >();
	let portableMediaBytes = 0;
	for ( const { selected } of portableMediaCandidates ) {
		if ( ! selected ) continue;
		const contentHash = fileHash( selected.localPath );
		if (
			portableMediaHashes.has( contentHash ) ||
			portableMediaBytes + selected.bytes <= MAX_PORTABLE_MEDIA_TOTAL_BYTES
		) {
			selectedPortableMedia.add( selected );
			if ( ! portableMediaHashes.has( contentHash ) ) {
				portableMediaHashes.add( contentHash );
				portableMediaBytes += selected.bytes;
			}
		}
	}
	let retainedExternalMediaCount = 0;
	const localizedMediaFamilies = new Set< string >();
	const assetPathsByHash = new Map< string, string >();
	const assetHashesByPath = new Map< string, string >();
	for ( const candidates of mediaFamilies.values() ) {
		const family = mediaFamily( candidates[ 0 ].sourceUrl );
		const selected = selectMediaCandidate( candidates );
		if ( ! selected ) {
			for ( const reference of retainedMediaFamilies.get( family ) ?? [] )
				mediaReplacements.set( reference, TRANSPARENT_IMAGE_DATA_URL );
			for ( const candidate of candidates ) {
				for ( const reference of candidate.references ) {
					mediaReplacements.set( reference, candidate.sourceUrl );
				}
				unresolvedMedia.push( {
					url: candidate.sourceUrl,
					error: 'removed because media exceeds portable size or dimension limits',
				} );
				retainedExternalMediaCount++;
			}
			continue;
		}
		if ( ! selectedPortableMedia.has( selected ) ) {
			for ( const candidate of candidates ) {
				for ( const reference of candidate.references ) {
					mediaReplacements.set( reference, TRANSPARENT_IMAGE_DATA_URL );
				}
			}
			unresolvedMedia.push( {
				url: selected.sourceUrl,
				error: 'removed because the aggregate portable media limit was reached',
			} );
			retainedExternalMediaCount++;
			continue;
		}
		const contentHash = fileHash( selected.localPath );
		let assetPath = assetPathsByHash.get( contentHash );
		if ( assetPath === undefined ) {
			assetPath = uniqueAssetPath(
				join( 'media', portableMediaBasename( selected ) ),
				contentHash,
				assetHashesByPath
			);
			const destination = join( websiteDir, assetPath );
			mkdirSync( dirname( destination ), { recursive: true } );
			copyFileSync( selected.localPath, destination );
			assetPathsByHash.set( contentHash, assetPath );
			assetHashesByPath.set( assetPath, contentHash );
			assets.push( {
				sourceUrl: selected.sourceUrl,
				path: join( 'website', assetPath ).replace( /\\/g, '/' ),
			} );
		}
		localizedMediaFamilies.add( family );
		for ( const reference of retainedMediaFamilies.get( family ) ?? [] )
			mediaReplacements.set( reference, `/${ assetPath.replace( /\\/g, '/' ) }` );
		for ( const candidate of candidates ) {
			for ( const reference of candidate.references ) {
				mediaReplacements.set( reference, `/${ assetPath.replace( /\\/g, '/' ) }` );
			}
		}
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
		if ( ! pathWithin( outputDir, source ) || ! existsSync( source ) ) {
			unresolvedDependencies.push( {
				url: dependency.url,
				sourceUrl,
				error: 'captured dependency file is unavailable',
			} );
			return false;
		}
		const requestedPath = portableResourcePath( resource.path, resource.contentType );
		if ( ! requestedPath ) {
			unresolvedDependencies.push( {
				url: dependency.url,
				sourceUrl,
				error: `captured dependency has no portable extension for ${
					resource.contentType || 'unknown content type'
				}`,
			} );
			return false;
		}
		const isText = /^(?:application\/json|text\/)/i.test( resource.contentType );
		const contentHash = isText ? '' : fileHash( source );
		const relativePath = isText
			? requestedPath
			: assetPathsByHash.get( contentHash ) ??
			  uniqueAssetPath( requestedPath, contentHash, assetHashesByPath );
		const destination = resolve( websiteDir, relativePath );
		const portablePath = `/${ relativePath.replace( /\\/g, '/' ) }`;
		resourceReplacements.set( dependency.reference, portablePath );
		resourceReplacements.set( dependency.url, portablePath );
		if ( ! isText && assetPathsByHash.has( contentHash ) ) return true;
		if ( copiedResources.has( resource.path ) ) return true;
		if ( copyingResources.has( resource.path ) ) return true;
		if ( ! pathWithin( websiteDir, destination ) ) {
			unresolvedDependencies.push( {
				url: dependency.url,
				sourceUrl,
				error: 'captured dependency file is unavailable',
			} );
			return false;
		}

		mkdirSync( dirname( destination ), { recursive: true } );
		copyingResources.add( resource.path );
		if ( isText ) {
			let content = replaceAll( readFileSync( source, 'utf8' ), mediaReplacements );
			if ( /text\/css/i.test( resource.contentType ) ) {
				for ( const nested of dependencyReferences( content, dependency.url, true ) ) {
					if ( ! copyResource( nested, dependency.url ) ) {
						content = replaceDanglingCssUrl( content, nested.reference );
					}
				}
			}
			writeFileSync( destination, replaceAll( content, resourceReplacements ) );
		} else {
			copyFileSync( source, destination );
			assetPathsByHash.set( contentHash, relativePath );
			assetHashesByPath.set( relativePath, contentHash );
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
		for ( const dependency of dependencyReferences( entry.html, entry.url ) ) {
			const mediaReplacement = mediaReplacements.get( dependency.reference );
			if ( mediaReplacement && ! /^(?:https?:)?\/\//i.test( mediaReplacement ) ) continue;
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
	const inlineStyles = new Map< string, { css: string; media: string; count: number } >();
	for ( const entry of retainedEntries ) {
		for ( const match of entry.html.matchAll( /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi ) ) {
			const style = portableInlineStyle( match[ 1 ], match[ 2 ] );
			if ( ! style ) continue;
			const existing = inlineStyles.get( style.key );
			inlineStyles.set( style.key, {
				css: match[ 2 ],
				media: style.media,
				count: ( existing?.count ?? 0 ) + 1,
			} );
		}
	}
	const sharedStyles = new Map< string, { path: string; media: string } >();
	for ( const [ key, style ] of inlineStyles ) {
		if ( style.count < 2 ) continue;
		const contentHash = createHash( 'sha256' ).update( key ).digest( 'hex' );
		const relativePath = `assets/css/capture-${ contentHash.slice( 0, 16 ) }.css`;
		const destination = join( websiteDir, relativePath );
		mkdirSync( dirname( destination ), { recursive: true } );
		writeFileSync( destination, style.css );
		assets.push( {
			sourceUrl: `${ options.sourceUrl }#inline-style-${ contentHash.slice( 0, 16 ) }`,
			path: `website/${ relativePath }`,
		} );
		sharedStyles.set( key, { path: `/${ relativePath }`, media: style.media } );
	}
	for ( const entry of retainedEntries ) {
		const linkedStyles = new Set< string >();
		const $ = cheerio.load( entry.html );
		$( 'style' ).each( ( _index, element ) => {
			const attributes = 'attribs' in element ? element.attribs : {};
			const style = portableInlineStyleValues(
				attributes.media ?? '',
				Object.keys( attributes ).some( ( name ) => name !== 'media' && name !== 'type' ),
				$( element ).html() ?? ''
			);
			const shared = style ? sharedStyles.get( style.key ) : undefined;
			if ( ! style || ! shared ) return;
			if ( linkedStyles.has( style.key ) ) {
				$( element ).remove();
				return;
			}
			linkedStyles.add( style.key );
			const link = $( '<link>' ).attr( { rel: 'stylesheet', href: shared.path } );
			if ( shared.media ) link.attr( 'media', shared.media );
			$( element ).replaceWith( link );
		} );
		entry.html = $.html();
	}

	const routes: Array< { url: string; path: string } > = [];
	const portableRouteLinks = new Map< string, string >();
	const claimedPaths = new Set< string >();
	for ( const { url } of retainedEntries ) {
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
		routes.push( { url, path: `website/${ routePath }` } );
	}
	for ( const { url, canonicalUrl } of retainedEntries ) {
		if ( ! canonicalUrl ) continue;
		const canonicalKey = normalizedUrl( canonicalUrl );
		if ( portableRouteLinks.has( canonicalKey ) ) continue;
		const routePath = routeOutputPath( url, options.sourceUrl, entrypointUrl ).replace(
			/\\/g,
			'/'
		);
		portableRouteLinks.set( canonicalKey, `/${ routePath }` );
	}

	const geometryHtmlByPath = new Map< string, { html: string; identityHtml: string } >();
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
		const identityHtml = replaceAll(
			rewriteMediaUrls(
				rewriteCapturedRouteLinks( html, url, portableRouteLinks ),
				mediaReplacements
			),
			resourceReplacements
		);
		const normalizedHtml = withoutGeometryIdentities( identityHtml );
		writeFileSync( destination, normalizedHtml );
		geometryHtmlByPath.set( `website/${ routePath }`, { html: normalizedHtml, identityHtml } );
	}

	const geometryInputs: Array< {
		sourcePath: string;
		html: string;
		identityHtml: string;
		observations: GeometryCapture[ 'observations' ];
	} > = [];
	const geometryCaptureOmissions: Record< string, number > = {};
	for ( const entry of retainedEntries ) {
		const observations: GeometryCapture[ 'observations' ] = [];
		for ( const viewport of [ 'desktop', 'mobile' ] ) {
			const path = join( outputDir, 'layout-geometry', `${ entry.slug }.${ viewport }.json` );
			if ( ! existsSync( path ) ) {
				geometryCaptureOmissions[ 'capture_missing' ] =
					( geometryCaptureOmissions[ 'capture_missing' ] ?? 0 ) + 1;
				continue;
			}
			try {
				const capture = JSON.parse( readFileSync( path, 'utf8' ) ) as GeometryCapture;
				if (
					capture.schema !== 'data-liberation/layout-geometry-capture/v1' ||
					! Array.isArray( capture.observations )
				) {
					throw new Error( 'schema_invalid' );
				}
				observations.push( ...capture.observations );
				for ( const [ code, count ] of Object.entries( capture.omissions ?? {} ) )
					geometryCaptureOmissions[ code ] = ( geometryCaptureOmissions[ code ] ?? 0 ) + count;
			} catch {
				geometryCaptureOmissions[ 'capture_invalid' ] =
					( geometryCaptureOmissions[ 'capture_invalid' ] ?? 0 ) + 1;
			}
		}
		geometryInputs.push( {
			sourcePath: routeOutputPath( entry.url, options.sourceUrl, entrypointUrl )
				.replace( /\\/g, '/' )
				.replace( /^/, 'website/' ),
			...( geometryHtmlByPath.get(
				`website/${ routeOutputPath( entry.url, options.sourceUrl, entrypointUrl ).replace(
					/\\/g,
					'/'
				) }`
			) ?? {
				html: readFileSync(
					join( websiteDir, routeOutputPath( entry.url, options.sourceUrl, entrypointUrl ) ),
					'utf8'
				),
				identityHtml: '',
			} ),
			observations,
		} );
	}
	const geometry = buildLayoutGeometryProof( geometryInputs );
	const geometryReport = {
		...geometry.report,
		capture_omissions: geometryCaptureOmissions,
	};
	writeFileSync(
		join( outputDir, 'layout-geometry-report.json' ),
		`${ JSON.stringify( geometryReport, null, 2 ) }\n`
	);

	const interactionStates = interactionPages.flatMap( ( page ) => page.states );
	const interactionSummary = {
		candidate_count: interactionStates.length,
		captured_count: interactionStates.filter( ( state ) => state.status === 'captured' ).length,
		no_dialog_count: interactionStates.filter( ( state ) => state.status === 'no-dialog' ).length,
		click_failed_count: interactionStates.filter( ( state ) => state.status === 'click-failed' )
			.length,
		truncated_count: interactionStates.filter(
			( state ) => state.status === 'captured' && state.dialog?.htmlTruncated
		).length,
	};
	const reportFiles = [ 'diagnostics.json', 'capture-receipt.json', 'layout-geometry-report.json' ];
	if ( interactionPages.length > 0 ) {
		writeFileSync(
			join( outputDir, 'interaction-states.json' ),
			`${ JSON.stringify(
				{
					schema: CAPTURED_INTERACTIONS_SCHEMA,
					pages: interactionPages,
					totals: interactionSummary,
				},
				null,
				2
			) }\n`
		);
		reportFiles.push( 'interaction-states.json' );
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
				interactions: interactionSummary,
				layoutGeometry: geometryReport,
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
				interactions: interactionSummary,
				interactionFailures: interactionStates.filter( ( state ) => state.status !== 'captured' ),
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
				...( geometry.proof ? { layout_geometry_proof: geometry.proof } : {} ),
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
		for ( const report of reportFiles ) {
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
			} ) },"reports":${ JSON.stringify( reportFiles ) }}\n`
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
