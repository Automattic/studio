import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';
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

function pathWithin( root: string, candidate: string ): boolean {
	const rel = relative( resolve( root ), resolve( candidate ) );
	return rel === '' || ( ! rel.startsWith( `..${ sep }` ) && rel !== '..' );
}

function resourcePath( url: URL, contentType = '' ): string {
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
	if ( /\.[a-z0-9]+$/i.test( cleanPath ) ) {
		return cleanPath.replace( /(\.[a-z0-9]+)$/i, `${ querySuffix }$1` );
	}
	const extension = new Map( [
		[ 'video/mp4', '.mp4' ],
		[ 'video/webm', '.webm' ],
		[ 'video/ogg', '.ogv' ],
		[ 'audio/mpeg', '.mp3' ],
		[ 'audio/ogg', '.ogg' ],
		[ 'audio/wav', '.wav' ],
	] ).get( contentType.split( ';', 1 )[ 0 ].trim().toLowerCase() );
	return extension ? `${ cleanPath }${ querySuffix }${ extension }` : `${ cleanPath }${ querySuffix }`;
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

	constructor(
		outputDir: string,
		sourceUrl: string,
		fetchMedia: ( url: string ) => Promise< SafeFetchResult > = ( url ) =>
			safeFetch( url, { maxBytes: MAX_CAPTURED_RESOURCE_BYTES } )
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
		if ( resourceUrl.origin !== this.origin ) return Promise.resolve();

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
		const relativePath = resourcePath( resourceUrl, headers[ 'content-type' ] );
		const destination = resolve( this.resourceDir, relativePath );
		if ( ! pathWithin( this.resourceDir, destination ) ) {
			throw new Error( 'resource path escapes the capture directory' );
		}
		const body = fetched?.body ?? ( await response.body() );
		if ( body.length > MAX_CAPTURED_RESOURCE_BYTES ) {
			throw new Error(
				`resource body ${ body.length } bytes exceeds max ${ MAX_CAPTURED_RESOURCE_BYTES }`
			);
		}
		mkdirSync( dirname( destination ), { recursive: true } );
		writeFileSync( destination, body );
		this.manifest.resources[ resourceUrl.href ] = {
			path: `resources/${ relativePath.replace( /\\/g, '/' ) }`,
			contentType: headers[ 'content-type' ] ?? '',
		};
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
