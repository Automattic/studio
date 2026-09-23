import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as cheerio from 'cheerio';
import { sourceSessionCookieHeader } from '../browser-kit/browser-kit.js';
import { MAX_REDIRECTS, safeFetch, type SafeFetchResult } from '../media-fetch/safe-fetch.js';
import type { Page, Request, Response } from 'playwright';

const CAPTURED_RESOURCE_TYPES = new Set( [
	'script',
	'stylesheet',
	'font',
	'fetch',
	'image',
	'media',
] );
const REPLAYABLE_RESOURCE_TYPES = new Set( [ 'script', 'stylesheet', 'font', 'image' ] );
const REPLAY_RESPONSE_HEADERS = new Set( [
	'access-control-allow-credentials',
	'access-control-allow-origin',
	'content-language',
	'cross-origin-resource-policy',
	'timing-allow-origin',
] );
// Tuned for the common case — images, fonts, stylesheets, scripts. Video/audio
// get their own, much wider ceiling below: a flat 10 MB cap rejects ordinary
// web video outright regardless of how much of the run's aggregate budget
// (MAX_CAPTURED_RESOURCE_TOTAL_BYTES) is actually free.
const MAX_CAPTURED_RESOURCE_BYTES = 10 * 1024 * 1024;
// Deliberately much larger than the default, but still bounded — and further
// capped by whatever remains of the aggregate budget (see
// `resourceByteCeiling`), so one big video can eat a large share of a run but
// never exceed it. Raising the flat constant for every type would relax the
// image/font/script cap too; scoping the wider ceiling to video/audio keeps
// those tuned as before.
// Exported so tests can assert against the real values instead of duplicating
// (and risking drift from) the constants below.
export const MAX_CAPTURED_VIDEO_RESOURCE_BYTES = 100 * 1024 * 1024;
export const MAX_CAPTURED_RESOURCE_TOTAL_BYTES = 256 * 1024 * 1024;
export const CAPTURED_RESOURCE_TIMEOUT_MS = 10_000;
// Hard ceiling on a single resource's read timeout, however large it is
// allowed to be — a stalled connection must not hang a capture run
// indefinitely just because the resource was permitted a wide byte ceiling.
export const CAPTURED_RESOURCE_TIMEOUT_CEILING_MS = 90_000;
// Conservative assumed minimum throughput used to scale a resource's read
// timeout with the bytes it may need to transfer. This only sets an UPPER
// bound on patience — a fast response still returns as soon as it arrives.
// At 2 MB/s the existing 10 MB image/font/script cap still resolves to
// exactly the previous flat 10s floor, so default behaviour is unchanged;
// a resource permitted the video ceiling gets proportionally more time.
const ASSUMED_MIN_THROUGHPUT_BYTES_PER_MS = ( 2 * 1024 * 1024 ) / 1000;
const MAX_DOM_RESOURCE_DEPENDENCIES = 256;
const MAX_DOM_RESOURCE_CAPTURE_MS = 120_000;
const DOM_RESOURCE_CONCURRENCY = 8;

/**
 * Scale a resource body's read timeout with how many bytes it may need to
 * transfer, floored at {@link CAPTURED_RESOURCE_TIMEOUT_MS} and capped at
 * {@link CAPTURED_RESOURCE_TIMEOUT_CEILING_MS}. `expectedBytes` is the
 * declared Content-Length when known, else the byte ceiling that was applied
 * (the largest this resource is allowed to be, and so the longest a genuine
 * download of it could take).
 */
export function resourceTimeoutMs( expectedBytes: number ): number {
	if ( ! Number.isFinite( expectedBytes ) || expectedBytes <= 0 ) return CAPTURED_RESOURCE_TIMEOUT_MS;
	const scaled = Math.ceil( expectedBytes / ASSUMED_MIN_THROUGHPUT_BYTES_PER_MS );
	return Math.min( CAPTURED_RESOURCE_TIMEOUT_CEILING_MS, Math.max( CAPTURED_RESOURCE_TIMEOUT_MS, scaled ) );
}

const VIDEO_AUDIO_EXTENSION_RE =
	/\.(?:mp4|m4v|mov|webm|ogv|mkv|avi|mpg|mpeg|mp3|m4a|aac|wav|flac|ogg)(?:[?#]|$)/i;

/**
 * Best-effort, generic (extension-only — no hostnames, no platform-specific
 * paths) "this is a video/audio resource" signal, used BEFORE a fetch starts
 * — when the response's real Content-Type isn't known yet — to pick a
 * per-resource byte ceiling appropriate to the resource kind instead of the
 * flat limit tuned for images.
 */
function looksLikeVideoOrAudioUrl( url: string | URL ): boolean {
	try {
		const pathname = typeof url === 'string' ? new URL( url ).pathname : url.pathname;
		return VIDEO_AUDIO_EXTENSION_RE.test( pathname );
	} catch {
		return false;
	}
}

function isVideoOrAudioContentType( contentType: string ): boolean {
	return /^(?:video|audio)\//i.test( contentType );
}

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

export interface CapturedResourceReplay {
	path: string;
	contentType: string;
	headers: Record< string, string >;
}

interface CapturedResourceReplayMetadata {
	expiresAt: number;
	headers: Record< string, string >;
}

function replayableResponseMetadata(
	headers: Record< string, string >
): CapturedResourceReplayMetadata | undefined {
	const cacheControl = headers[ 'cache-control' ] ?? '';
	if (
		! /(?:^|,)\s*public\s*(?:,|$)/i.test( cacheControl ) ||
		/(?:^|,)\s*(?:no-cache|no-store|private)(?:\s*(?:,|$)|\s*=)/i.test( cacheControl ) ||
		headers[ 'set-cookie' ]
	) {
		return undefined;
	}
	const maxAgeMatch = cacheControl.match( /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i );
	const maxAge = maxAgeMatch ? Number( maxAgeMatch[ 1 ] ) : undefined;
	const age = Number( headers.age ?? 0 );
	const responseAge = Number.isFinite( age ) ? age : 0;
	const expiresAt = Number.isFinite( maxAge )
		? Date.now() + ( maxAge! - responseAge ) * 1000
		: Date.parse( headers.expires ?? '' );
	if ( ! Number.isFinite( expiresAt ) || expiresAt <= Date.now() ) return undefined;

	const vary = ( headers.vary ?? '' )
		.split( ',' )
		.map( ( value ) => value.trim().toLowerCase() )
		.filter( Boolean );
	if ( vary.some( ( value ) => ! [ 'accept-encoding', 'origin' ].includes( value ) ) ) {
		return undefined;
	}

	return {
		expiresAt,
		headers: Object.fromEntries(
			Object.entries( headers ).filter( ( [ name ] ) => REPLAY_RESPONSE_HEADERS.has( name ) )
		),
	};
}

async function responseBodyWithTimeout(
	response: Response,
	timeoutMs: number = CAPTURED_RESOURCE_TIMEOUT_MS
): Promise< Buffer > {
	let timeout: ReturnType< typeof setTimeout > | undefined;
	try {
		return await Promise.race( [
			response.body(),
			new Promise< never >( ( _, reject ) => {
				timeout = setTimeout(
					() => reject( new Error( `resource body timed out after ${ timeoutMs }ms` ) ),
					timeoutMs
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

/**
 * A redirected request's own `url()` is the POST-redirect target: the server
 * responded with a redirect and Playwright created a NEW Request for the
 * target, linked back via `redirectedFrom()`. The document only ever
 * referenced the FIRST url in that chain — that is the identity a rewrite
 * must match and the local path must derive from, not a transport detail
 * like a session-gated origin's private-variant path. Walk back to it,
 * bounded by the same redirect cap safeFetch enforces; fall back to
 * `fallback` if the request has no redirect chain (the common case) or a
 * hop's url is unparseable.
 */
function originRequestUrl( request: Request, fallback: URL ): URL {
	let current = request;
	for ( let hop = 0; hop < MAX_REDIRECTS; hop++ ) {
		const previous = current.redirectedFrom?.();
		if ( ! previous ) break;
		current = previous;
	}
	try {
		return new URL( current.url() );
	} catch {
		return fallback;
	}
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
	const extension = new Map( [
		[ 'video/mp4', '.mp4' ],
		[ 'video/webm', '.webm' ],
		[ 'video/ogg', '.ogv' ],
		[ 'audio/mpeg', '.mp3' ],
		[ 'audio/ogg', '.ogg' ],
		[ 'audio/wav', '.wav' ],
		[ 'image/avif', '.avif' ],
		[ 'image/gif', '.gif' ],
		[ 'image/jpeg', '.jpg' ],
		[ 'image/png', '.png' ],
		[ 'image/svg+xml', '.svg' ],
		[ 'image/webp', '.webp' ],
	] ).get( contentType.split( ';', 1 )[ 0 ].trim().toLowerCase() );
	// CDNs can transcode a URL ending in .png to WebP. Store the response under
	// its declared format so a static server supplies a matching MIME type offline.
	const pathWithSuffix = /\.[a-z0-9]+$/i.test( cleanPath )
		? cleanPath.replace( /(\.[a-z0-9]+)$/i, `${ querySuffix }${ extension ?? '$1' }` )
		: undefined;
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

function canonicalContentType( contentType: string ): string {
	const normalized = contentType.trim().toLowerCase();
	return {
		woff2: 'font/woff2',
		'application/font-woff2': 'font/woff2',
		'application/x-font-woff2': 'font/woff2',
		'application/font-woff': 'font/woff',
		'application/x-font-woff': 'font/woff',
		'application/font-ttf': 'font/ttf',
		'application/x-font-ttf': 'font/ttf',
		'application/font-otf': 'font/otf',
		'application/x-font-otf': 'font/otf',
	}[ normalized ] ?? contentType;
}

export function isAudioLink( reference: string, documentUrl: string ): boolean {
	try {
		const url = new URL( reference.replace( /&amp;/g, '&' ), documentUrl );
		return /^https?:$/.test( url.protocol ) && /\.(?:mp3|ogg|wav)$/i.test( url.pathname );
	} catch {
		return false;
	}
}

export class CapturedResourceStore {
	private readonly origin: string;
	private readonly resourceDir: string;
	private readonly manifestPath: string;
	private readonly manifest: CapturedResourceManifest;
	private readonly captures = new Map< string, Promise< void > >();
	private readonly pageCaptures = new WeakMap< Page, Set< Promise< void > > >();
	private readonly listeners = new WeakMap< Page, ( response: Response ) => void >();
	private readonly replayMetadata = new Map< string, CapturedResourceReplayMetadata >();
	private readonly replayResources = new Map<
		string,
		{ path: string; contentType: string }
	>();
	// The caller (below) decides maxBytes/timeoutMs PER CALL — a resource-kind
	// and remaining-budget aware ceiling (see `resourceByteCeiling`), not a
	// single constant baked into this function — so this seam stays a thin
	// forward to `safeFetch` with whatever bound was chosen for that resource.
	private readonly fetchMedia: (
		url: string,
		maxBytes: number,
		timeoutMs: number
	) => Promise< SafeFetchResult >;
	private replayDir?: string;
	private replayBytes = 0;
	private capturedBytes = 0;

	constructor(
		outputDir: string,
		sourceUrl: string,
		// A source gated behind an entry-URL-only session (the URL carries a
		// token, the origin answers with Set-Cookie) requires that cookie for
		// EVERY asset, not just the navigated document — video and poster URLs
		// referenced in the DOM are fetched independently here, never through
		// the browser that holds the session. Without it every such asset
		// 403s, which used to surface as "never captured" rather than an
		// authentication failure.
		fetchMedia: (
			url: string,
			maxBytes: number,
			timeoutMs: number
		) => Promise< SafeFetchResult > = ( url, maxBytes, timeoutMs ) =>
			safeFetch( url, {
				maxBytes,
				timeoutMs,
				headersForOrigin: async ( origin ) => {
					const cookie = await sourceSessionCookieHeader( origin );
					return cookie ? { cookie } : undefined;
				},
			} )
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
		try {
			await Promise.all( this.captures.values() );
			mkdirSync( dirname( this.manifestPath ), { recursive: true } );
			writeFileSync( this.manifestPath, `${ JSON.stringify( this.manifest, null, 2 ) }\n` );
		} finally {
			if ( this.replayDir ) rmSync( this.replayDir, { recursive: true, force: true } );
		}
	}

	getReplayableResponse( url: string, resourceType: string ): CapturedResourceReplay | undefined {
		if ( ! REPLAYABLE_RESOURCE_TYPES.has( resourceType ) ) return undefined;
		const resource = this.replayResources.get( url );
		const metadata = this.replayMetadata.get( url );
		if (
			! resource ||
			! metadata ||
			metadata.expiresAt <= Date.now()
		)
			return undefined;
		if ( ! existsSync( resource.path ) ) return undefined;
		return { ...resource, headers: metadata.headers };
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
		const collect = ( content: string, baseUrl: string, cssOnly = false ) => {
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
			$( 'a[href],area[href]' ).each( ( _, element ) => {
				const href = $( element ).attr( 'href' ) ?? '';
				if ( isAudioLink( href, baseUrl ) ) add( href, baseUrl );
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
			const css = cssOnly
				? content
				: [
						...$( 'style' )
							.map( ( _, element ) => $( element ).html() ?? '' )
							.get(),
						...$( '[style]' )
							.map( ( _, element ) => $( element ).attr( 'style' ) ?? '' )
							.get(),
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
						url,
						true
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

		// A 3xx response is a transport hop, not a completed resource: Playwright
		// fires a SEPARATE 'response' event (with its own Request) for the
		// redirect target, so this one contributes nothing to capture. Recording
		// it here would both log a misleading "HTTP 3xx" failure for an asset
		// that succeeds one hop later, AND — since a redirect response's own
		// url() IS the pre-redirect requested url — claim the dedupe/manifest
		// key that the terminal response below needs to write under, which
		// would silently block that later, successful capture.
		if ( response.status() >= 300 && response.status() < 400 ) return Promise.resolve();

		let resourceUrl: URL;
		try {
			resourceUrl = new URL( response.url() );
		} catch {
			return Promise.resolve();
		}
		// Preserve only passive CDN inputs in the portable artifact. Cache immutable
		// provider scripts ephemerally to restore the browser cache disabled by routing.
		if (
			resourceUrl.origin !== this.origin &&
			! EXTERNAL_PASSIVE_RESOURCE_TYPES.has( resourceType )
		) {
			if ( resourceType === 'script' && request.method() === 'GET' ) {
				return this.captureReplayOnly( response, resourceUrl );
			}
			return Promise.resolve();
		}

		// Identity for the dedupe key, manifest key, and local path is the
		// ORIGINALLY requested url — what the document references — not
		// wherever a redirect ultimately resolved it to.
		const requestedUrl = originRequestUrl( request, resourceUrl );
		const url = requestedUrl.href;
		const existing = this.captures.get( url );
		if ( existing ) return existing;

		const capture = this.captureResponse( response, requestedUrl, resourceType ).catch(
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

	private captureReplayOnly( response: Response, resourceUrl: URL ): Promise< void > {
		const url = resourceUrl.href;
		const existing = this.captures.get( url );
		if ( existing ) return existing;
		const capture = ( async () => {
			if ( response.status() < 200 || response.status() >= 300 ) return;
			const headers = response.headers();
			const metadata = replayableResponseMetadata( headers );
			if ( ! metadata ) return;
			const declaredBytes = Number( headers[ 'content-length' ] );
			if (
				Number.isFinite( declaredBytes ) &&
				declaredBytes > MAX_CAPTURED_RESOURCE_BYTES
			)
				return;
			const body = await responseBodyWithTimeout( response );
			if (
				body.length > MAX_CAPTURED_RESOURCE_BYTES ||
				this.replayBytes + body.length > MAX_CAPTURED_RESOURCE_TOTAL_BYTES
			)
				return;
			this.replayDir ??= mkdtempSync( join( tmpdir(), 'dla-resource-replay-' ) );
			const path = join( this.replayDir, createHash( 'sha256' ).update( url ).digest( 'hex' ) );
			writeFileSync( path, body );
			this.replayBytes += body.length;
			this.replayResources.set( url, {
				path,
				contentType: canonicalContentType( headers[ 'content-type' ] ?? '' ),
			} );
			this.replayMetadata.set( url, metadata );
		} )().catch( () => {
			// Ephemeral cache misses must not become portable artifact failures.
		} );
		this.captures.set( url, capture );
		return capture;
	}

	private captureUrl( url: string ): Promise< void > {
		const existing = this.captures.get( url );
		if ( existing ) return existing;
		const capture = ( async () => {
			// The real Content-Type isn't known until the fetch responds, so the
			// wider video/audio ceiling (when warranted) is decided from the url
			// alone here — `safeFetch` enforces `maxBytes` DURING the fetch, so
			// this can't be deferred to a post-fetch check the way the
			// browser-observed path below can.
			const byteCeiling = this.resourceByteCeiling( looksLikeVideoOrAudioUrl( url ) );
			const fetched = await this.fetchMedia( url, byteCeiling, resourceTimeoutMs( byteCeiling ) );
			if ( fetched.status < 200 || fetched.status >= 300 )
				throw new Error( `HTTP ${ fetched.status }` );
			const contentType = canonicalContentType( fetched.headers.get( 'content-type' ) ?? '' );
			// A 200 with no bytes is not a usable asset. Storing it would record a
			// successful capture whose font or image renders as nothing downstream.
			if ( fetched.body.length === 0 )
				throw new Error( 'render dependency response body is empty' );
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
			this.replayResources.set( url, { path: destination, contentType } );
			const metadata = replayableResponseMetadata(
				Object.fromEntries( fetched.headers.entries() )
			);
			if ( metadata ) this.replayMetadata.set( url, metadata );
		} )().catch( ( error: unknown ) => {
			this.manifest.failures.push( {
				url,
				error: error instanceof Error ? error.message : String( error ),
			} );
		} );
		this.captures.set( url, capture );
		return capture;
	}

	/**
	 * @param requestedUrl The url the document referenced — the ORIGINAL
	 *   pre-redirect url when `response` resolved through one or more
	 *   redirects (see {@link originRequestUrl}). Identity (manifest key,
	 *   local path) derives from this; `response` still supplies the actual
	 *   fetched bytes/headers for a non-`media` resourceType.
	 */
	private async captureResponse(
		response: Response,
		requestedUrl: URL,
		resourceType: string
	): Promise< void > {
		// Playwright's own resourceType already tells us 'media' (<video>/
		// <audio> element loads) is audio/video before fetching anything, so
		// the wider ceiling can be picked up front for that path. Every other
		// resourceType (including 'fetch' — some players stream video chunks
		// through fetch()/XHR rather than a <video> element) only reveals
		// whether it's really audio/video once its Content-Type header is read
		// below, which happens before any body is read either way.
		const isMedia = resourceType === 'media';
		const mediaByteCeiling = this.resourceByteCeiling( isMedia );
		const fetched = isMedia
			? await this.fetchMedia(
					requestedUrl.href,
					mediaByteCeiling,
					resourceTimeoutMs( mediaByteCeiling )
			  )
			: undefined;
		const status = fetched?.status ?? response.status();
		if ( status < 200 || status >= 300 ) throw new Error( `HTTP ${ status }` );
		const headers = fetched ? Object.fromEntries( fetched.headers.entries() ) : response.headers();
		const contentType = canonicalContentType( headers[ 'content-type' ] ?? '' );
		const byteCeiling = fetched
			? mediaByteCeiling
			: this.resourceByteCeiling( isVideoOrAudioContentType( contentType ) );
		const declaredBytes = Number( headers[ 'content-length' ] );
		if ( Number.isFinite( declaredBytes ) && declaredBytes > byteCeiling ) {
			throw new Error( `resource body ${ declaredBytes } bytes exceeds max ${ byteCeiling }` );
		}
		const relativePath = resourcePath( requestedUrl, contentType, this.origin );
		const destination = resolve( this.resourceDir, relativePath );
		if ( ! pathWithin( this.resourceDir, destination ) ) {
			throw new Error( 'resource path escapes the capture directory' );
		}
		const body =
			fetched?.body ??
			( await responseBodyWithTimeout(
				response,
				resourceTimeoutMs( Number.isFinite( declaredBytes ) ? declaredBytes : byteCeiling )
			) );
		// A 200 with no bytes is not a usable asset; record it as a failed
		// dependency rather than a resource that silently renders as nothing.
		if ( body.length === 0 ) {
			throw new Error( 'render dependency response body is empty' );
		}
		if ( body.length > byteCeiling ) {
			throw new Error( `resource body ${ body.length } bytes exceeds max ${ byteCeiling }` );
		}
		this.reserveBytes( body.length );
		mkdirSync( dirname( destination ), { recursive: true } );
		writeFileSync( destination, body );
		this.manifest.resources[ requestedUrl.href ] = {
			path: `resources/${ relativePath.replace( /\\/g, '/' ) }`,
			contentType,
		};
		this.replayResources.set( requestedUrl.href, { path: destination, contentType } );
		const replayMetadata = replayableResponseMetadata( headers );
		if ( replayMetadata ) this.replayMetadata.set( requestedUrl.href, replayMetadata );
	}

	/**
	 * The byte ceiling for a single resource capture. Video/audio get a much
	 * wider ceiling than the flat limit tuned for images — but never wider
	 * than what remains of the run's aggregate resource budget
	 * ({@link MAX_CAPTURED_RESOURCE_TOTAL_BYTES}) AT THE TIME IT IS CALLED, so
	 * a single large asset cannot request more than the run has left. This is
	 * a snapshot, not a reservation — concurrent captures can still both read
	 * the same "remaining" figure before either writes, so `reserveBytes`
	 * below remains the authoritative backstop that the aggregate is never
	 * exceeded on disk, exactly as it was before this per-resource ceiling
	 * existed.
	 */
	private resourceByteCeiling( isVideoLike: boolean ): number {
		const typeCeiling = isVideoLike ? MAX_CAPTURED_VIDEO_RESOURCE_BYTES : MAX_CAPTURED_RESOURCE_BYTES;
		const remaining = Math.max( 0, MAX_CAPTURED_RESOURCE_TOTAL_BYTES - this.capturedBytes );
		return Math.min( typeCeiling, remaining );
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
