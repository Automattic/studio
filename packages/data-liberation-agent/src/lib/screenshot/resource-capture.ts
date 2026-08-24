import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import * as cheerio from 'cheerio';
import { safeFetch, type SafeFetchResult } from '../media-fetch/safe-fetch.js';
import type { Page, Response } from 'playwright';

const CAPTURED_RESOURCE_TYPES = new Set( [
	'script',
	'stylesheet',
	'font',
	'fetch',
	'image',
	'media',
] );
const MAX_CAPTURED_RESOURCE_BYTES = 10 * 1024 * 1024;
const MAX_CAPTURED_RESOURCE_TOTAL_BYTES = 256 * 1024 * 1024;
const CAPTURED_RESOURCE_TIMEOUT_MS = 10_000;
const MAX_DOM_RESOURCE_DEPENDENCIES = 256;
const MAX_DOM_RESOURCE_CAPTURE_MS = 120_000;
const DOM_RESOURCE_CONCURRENCY = 8;

export interface CapturedResourceEntry {
	path: string;
	contentType: string;
}

export interface CapturedResourceFailure {
	url: string;
	error: string;
}

export interface CapturedResourceManifest {
	version: 1;
	resources: Record< string, CapturedResourceEntry >;
	failures: CapturedResourceFailure[];
}

async function responseBodyWithTimeout( response: Response ): Promise< Buffer > {
	let timeout: ReturnType< typeof setTimeout > | undefined;
	try {
		return await Promise.race( [
			response.body(),
			new Promise< never >( ( _, reject ) => {
				timeout = setTimeout(
					() =>
						reject(
							new Error( `resource body timed out after ${ CAPTURED_RESOURCE_TIMEOUT_MS }ms` )
						),
					CAPTURED_RESOURCE_TIMEOUT_MS
				);
			} ),
		] );
	} finally {
		if ( timeout ) clearTimeout( timeout );
	}
}

function pathWithin( root: string, candidate: string ): boolean {
	const rel = relative( resolve( root ), resolve( candidate ) );
	return rel === '' || ( ! rel.startsWith( `..${ sep }` ) && rel !== '..' );
}

function resourcePath( url: URL, contentType = '', sourceOrigin?: string ): string {
	let pathname: string;
	try {
		pathname = decodeURIComponent( url.pathname );
	} catch {
		pathname = url.pathname;
	}
	const cleanPath = pathname.replace( /^\/+/, '' );
	if ( ! cleanPath || cleanPath.split( /[\\/]/ ).includes( '..' ) ) {
		throw new Error( 'resource URL does not resolve to a safe file path' );
	}
	const querySuffix = url.search
		? `-${ createHash( 'sha256' ).update( url.search ).digest( 'hex' ).slice( 0, 12 ) }`
		: '';
	const pathWithSuffix = /\.[a-z0-9]+$/i.test( cleanPath )
		? cleanPath.replace( /(\.[a-z0-9]+)$/i, `${ querySuffix }$1` )
		: undefined;
	const extension = new Map( [
		[ 'video/mp4', '.mp4' ],
		[ 'video/webm', '.webm' ],
		[ 'video/ogg', '.ogv' ],
		[ 'audio/mpeg', '.mp3' ],
		[ 'audio/ogg', '.ogg' ],
		[ 'audio/wav', '.wav' ],
	] ).get( contentType.split( ';', 1 )[ 0 ].trim().toLowerCase() );
	const path =
		pathWithSuffix ??
		( extension
			? `${ cleanPath }${ querySuffix }${ extension }`
			: `${ cleanPath }${ querySuffix }` );
	return sourceOrigin && url.origin !== sourceOrigin
		? `external/${ createHash( 'sha256' )
				.update( url.origin )
				.digest( 'hex' )
				.slice( 0, 16 ) }/${ path }`
		: path;
}

const EXTERNAL_PASSIVE_RESOURCE_TYPES = new Set( [ 'stylesheet', 'font', 'image', 'media' ] );

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

export class CapturedResourceStore {
	private readonly origin: string;
	private readonly resourceDir: string;
	private readonly manifestPath: string;
	private readonly manifest: CapturedResourceManifest;
	private readonly captures = new Map< string, Promise< void > >();
	private readonly pageCaptures = new WeakMap< Page, Set< Promise< void > > >();
	private readonly listeners = new WeakMap< Page, ( response: Response ) => void >();
	private readonly fetchMedia: ( url: string ) => Promise< SafeFetchResult >;
	private capturedBytes = 0;

	constructor(
		outputDir: string,
		sourceUrl: string,
		fetchMedia: ( url: string ) => Promise< SafeFetchResult > = ( url ) =>
			safeFetch( url, { maxBytes: MAX_CAPTURED_RESOURCE_BYTES, timeoutMs: 10_000 } )
	) {
		this.origin = new URL( sourceUrl ).origin;
		this.resourceDir = resolve( outputDir, 'resources' );
		this.manifestPath = resolve( outputDir, 'resources', 'manifest.json' );
		this.manifest = this.loadManifest();
		this.fetchMedia = fetchMedia;
	}

	observe( page: Page ): void {
		const pending = new Set< Promise< void > >();
		this.pageCaptures.set( page, pending );
		const listener = ( response: Response ) => {
			const capture = this.capture( response );
			pending.add( capture );
			void capture.finally( () => pending.delete( capture ) );
		};
		this.listeners.set( page, listener );
		page.on?.( 'response', listener );
	}

	async settle( page: Page ): Promise< void > {
		const listener = this.listeners.get( page );
		if ( listener ) page.off?.( 'response', listener );
		await Promise.all( this.pageCaptures.get( page ) ?? [] );
	}

	async flush(): Promise< void > {
		await Promise.all( this.captures.values() );
		mkdirSync( dirname( this.manifestPath ), { recursive: true } );
		writeFileSync( this.manifestPath, `${ JSON.stringify( this.manifest, null, 2 ) }\n` );
	}

	async captureDomDependencies( html: string, documentUrl: string ): Promise< void > {
		const pending = new Map< string, string >();
		const add = ( reference: string, baseUrl: string ) => {
			if ( ! reference || reference.startsWith( 'data:' ) || reference.startsWith( '#' ) ) return;
			try {
				const url = new URL( reference.replace( /&amp;/g, '&' ), baseUrl );
				if ( url.protocol === 'http:' || url.protocol === 'https:' )
					pending.set( url.href, url.href );
			} catch {
				// Invalid browser values are removed by export's render-dependency pass.
			}
		};
		const collect = ( content: string, baseUrl: string ) => {
			const $ = cheerio.load( content );
			$(
				'img[src],img[srcset],source[src],source[srcset],video[src],audio[src],video[poster]'
			).each( ( _, element ) => {
				const node = $( element );
				for ( const attribute of [ 'src', 'poster' ] ) {
					const value = node.attr( attribute );
					if ( value ) add( value, baseUrl );
				}
				for ( const candidate of srcsetReferences( node.attr( 'srcset' ) ?? '' ) )
					add( candidate, baseUrl );
			} );
			$( 'link[href]' ).each( ( _, element ) => {
				const node = $( element );
				const rel = ( node.attr( 'rel' ) ?? '' ).toLowerCase().split( /\s+/ );
				const as = ( node.attr( 'as' ) ?? '' ).toLowerCase();
				if (
					rel.includes( 'stylesheet' ) ||
					rel.some( ( value ) => /(?:^|-)icon$/.test( value ) ) ||
					( rel.includes( 'preload' ) && [ 'style', 'font', 'image', 'media' ].includes( as ) )
				)
					add( node.attr( 'href' ) ?? '', baseUrl );
			} );
			const css = [
				...$( 'style' )
					.map( ( _, element ) => $( element ).html() ?? '' )
					.get(),
				...$( '[style]' )
					.map( ( _, element ) => $( element ).attr( 'style' ) ?? '' )
					.get(),
				content.startsWith( '@' ) || /\{[^}]*\}/.test( content ) ? content : '',
			].join( '\n' );
			for ( const match of css.matchAll(
				/(?:url\(\s*(?:["']([^"']+)["']|([^\s)'";]+))\s*\)|@import\s+(?:url\(\s*)?["']([^"']+)["'])/gi
			) )
				add( match[ 1 ] ?? match[ 2 ] ?? match[ 3 ] ?? '', baseUrl );
		};

		collect( html, documentUrl );
		const startedAt = Date.now();
		const processed = new Set< string >();
		while ( true ) {
			if ( Date.now() - startedAt >= MAX_DOM_RESOURCE_CAPTURE_MS ) {
				this.manifest.failures.push( {
					url: documentUrl,
					error: `DOM render dependency capture exceeded ${ MAX_DOM_RESOURCE_CAPTURE_MS }ms`,
				} );
				break;
			}
			const batch = [ ...pending.keys() ]
				.filter( ( url ) => ! processed.has( url ) )
				.slice(
					0,
					Math.min( DOM_RESOURCE_CONCURRENCY, MAX_DOM_RESOURCE_DEPENDENCIES - processed.size )
				);
			if ( batch.length === 0 ) {
				if ( [ ...pending.keys() ].some( ( url ) => ! processed.has( url ) ) ) {
					this.manifest.failures.push( {
						url: documentUrl,
						error: `DOM render dependencies exceed max ${ MAX_DOM_RESOURCE_DEPENDENCIES }`,
					} );
				}
				break;
			}
			for ( const url of batch ) processed.add( url );
			await Promise.all( batch.map( ( url ) => this.captureUrl( url ) ) );
			for ( const url of batch ) {
				const resource = this.manifest.resources[ url ];
				if ( ! resource?.contentType.toLowerCase().startsWith( 'text/css' ) ) continue;
				try {
					collect(
						readFileSync(
							resolve( this.resourceDir, resource.path.replace( /^resources\//, '' ) ),
							'utf8'
						),
						url
					);
				} catch {
					// captureUrl records unavailable resources in the manifest.
				}
			}
		}
	}

	private capture( response: Response ): Promise< void > {
		const request = response.request();
		const resourceType = request.resourceType();
		if ( ! CAPTURED_RESOURCE_TYPES.has( resourceType ) ) return Promise.resolve();

		let resourceUrl: URL;
		try {
			resourceUrl = new URL( response.url() );
		} catch {
			return Promise.resolve();
		}
		// Preserve passive render inputs from CDNs, never provider executable/runtime traffic.
		if (
			resourceUrl.origin !== this.origin &&
			! EXTERNAL_PASSIVE_RESOURCE_TYPES.has( resourceType )
		) {
			return Promise.resolve();
		}

		const url = resourceUrl.href;
		const existing = this.captures.get( url );
		if ( existing ) return existing;

		const capture = this.captureResponse( response, resourceUrl, resourceType ).catch(
			( error: unknown ) => {
				this.manifest.failures.push( {
					url,
					error: error instanceof Error ? error.message : String( error ),
				} );
			}
		);
		this.captures.set( url, capture );
		return capture;
	}

	private captureUrl( url: string ): Promise< void > {
		const existing = this.captures.get( url );
		if ( existing ) return existing;
		const capture = ( async () => {
			const fetched = await this.fetchMedia( url );
			if ( fetched.status < 200 || fetched.status >= 300 )
				throw new Error( `HTTP ${ fetched.status }` );
			const contentType = fetched.headers.get( 'content-type' ) ?? '';
			if (
				! /^(?:text\/css|image\/|audio\/|video\/|font\/|application\/(?:font|x-font|font-woff|octet-stream))/i.test(
					contentType
				)
			)
				throw new Error(
					`render dependency has unsupported content type ${ contentType || 'unknown' }`
				);
			const resourceUrl = new URL( url );
			const relativePath = resourcePath( resourceUrl, contentType, this.origin );
			const destination = resolve( this.resourceDir, relativePath );
			if ( ! pathWithin( this.resourceDir, destination ) )
				throw new Error( 'resource path escapes the capture directory' );
			this.reserveBytes( fetched.body.length );
			mkdirSync( dirname( destination ), { recursive: true } );
			writeFileSync( destination, fetched.body );
			this.manifest.resources[ url ] = {
				path: `resources/${ relativePath.replace( /\\/g, '/' ) }`,
				contentType,
			};
		} )().catch( ( error: unknown ) => {
			this.manifest.failures.push( {
				url,
				error: error instanceof Error ? error.message : String( error ),
			} );
		} );
		this.captures.set( url, capture );
		return capture;
	}

	private async captureResponse(
		response: Response,
		resourceUrl: URL,
		resourceType: string
	): Promise< void > {
		const fetched =
			resourceType === 'media' ? await this.fetchMedia( resourceUrl.href ) : undefined;
		const status = fetched?.status ?? response.status();
		if ( status < 200 || status >= 300 ) throw new Error( `HTTP ${ status }` );
		const headers = fetched ? Object.fromEntries( fetched.headers.entries() ) : response.headers();
		const declaredBytes = Number( headers[ 'content-length' ] );
		if ( Number.isFinite( declaredBytes ) && declaredBytes > MAX_CAPTURED_RESOURCE_BYTES ) {
			throw new Error(
				`resource body ${ declaredBytes } bytes exceeds max ${ MAX_CAPTURED_RESOURCE_BYTES }`
			);
		}
		const relativePath = resourcePath( resourceUrl, headers[ 'content-type' ], this.origin );
		const destination = resolve( this.resourceDir, relativePath );
		if ( ! pathWithin( this.resourceDir, destination ) ) {
			throw new Error( 'resource path escapes the capture directory' );
		}
		const body = fetched?.body ?? ( await responseBodyWithTimeout( response ) );
		if ( body.length > MAX_CAPTURED_RESOURCE_BYTES ) {
			throw new Error(
				`resource body ${ body.length } bytes exceeds max ${ MAX_CAPTURED_RESOURCE_BYTES }`
			);
		}
		this.reserveBytes( body.length );
		mkdirSync( dirname( destination ), { recursive: true } );
		writeFileSync( destination, body );
		this.manifest.resources[ resourceUrl.href ] = {
			path: `resources/${ relativePath.replace( /\\/g, '/' ) }`,
			contentType: headers[ 'content-type' ] ?? '',
		};
	}

	private reserveBytes( bytes: number ): void {
		if ( this.capturedBytes + bytes > MAX_CAPTURED_RESOURCE_TOTAL_BYTES ) {
			throw new Error(
				`captured resource bytes exceed aggregate max ${ MAX_CAPTURED_RESOURCE_TOTAL_BYTES }`
			);
		}
		this.capturedBytes += bytes;
	}

	private loadManifest(): CapturedResourceManifest {
		if ( existsSync( this.manifestPath ) ) {
			try {
				const manifest = JSON.parse(
					readFileSync( this.manifestPath, 'utf8' )
				) as CapturedResourceManifest;
				if ( manifest.version === 1 && manifest.resources && Array.isArray( manifest.failures ) ) {
					return manifest;
				}
			} catch {
				// Replace an invalid manifest with the current capture contract.
			}
		}
		return { version: 1, resources: {}, failures: [] };
	}
}
