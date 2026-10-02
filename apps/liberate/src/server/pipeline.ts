import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as pump } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { assertPublicHost, UserError } from './guards.ts';
import type { Config } from './config.ts';
import type { JobProgress, Runner } from './jobs.ts';

type Log = ( event: string, data: Record< string, unknown > ) => void;

const SCOPE = 'static-site-import-preview';
/** Tokens last 15 minutes and the response carries no reliable expiry. */
const TOKEN_TTL_MS = 14 * 60_000;
/** Codes that mean "not now" rather than "not ever". */
const RETRY_CODES = new Set( [
	'static_site_import_preview_busy',
	'static_site_import_preview_unavailable',
] );
/** A poll can fail without the capture failing; only a run of failures ends the job. */
const POLL_FAILURES_ALLOWED = 3;

/** The session fields liberate.sh reads. The endpoint returns more. */
export interface Session {
	session_id: string;
	state:
		| 'capture_queued'
		| 'capturing'
		| 'building'
		| 'preview_ready'
		| 'queued'
		| 'finished'
		| 'failed';
	/** Signed, and refreshed on every poll, so it is fetched as soon as it appears. */
	archive_url?: string;
	archive_hash?: string;
	/** Carries the reason on a failed session. */
	receipt?: { success?: boolean; code?: string };
	/** Bounded evidence about the copy: counts, the importer's own verdict, no source text. */
	preview_summary?: {
		pages?: number;
		quality_pass?: boolean;
		fidelity?: { measured?: boolean; pass?: boolean };
	};
	progress?: {
		finding_pages?: boolean;
		pages_captured?: number;
		pages_total?: number;
	};
}

/** Capacity, not a bad address: worth another try later. */
const BUSY_CODES = new Set( [
	'static_site_import_preview_daily_limit',
	'static_site_import_session_limit_exceeded',
	'static_site_import_preview_storage_failed',
	...RETRY_CODES,
] );

const UNUSABLE_SOURCE = 'We couldn’t copy this site. It may block automated visits.';
const QUALITY_WARNING =
	'Parts of this site didn’t convert cleanly, so some pages may be missing pieces.';
const BUSY = 'liberate.sh is at capacity right now. Please try again later.';

class ApiError extends Error {
	code: string;
	status: number;

	constructor( code: string, status: number, message: string ) {
		super( message );
		this.code = code;
		this.status = status;
	}
}

/**
 * The WordPress.com preview API, as the registered liberate.sh app: a client-credentials
 * bearer with one scope and no user or blog behind it.
 */
function previewApi( config: Config ) {
	const { apiBase, wpcom } = config;
	let token: { value: string; expiresAt: number } | undefined;

	const bearer = async ( signal: AbortSignal ) => {
		if ( token && token.expiresAt > Date.now() + 60_000 ) {
			return token.value;
		}
		const response = await fetch( `${ apiBase }/oauth2/token`, {
			method: 'POST',
			body: new URLSearchParams( {
				grant_type: 'client_credentials',
				client_id: wpcom!.clientId,
				client_secret: wpcom!.clientSecret,
				scope: SCOPE,
			} ),
			signal,
		} );
		const body = ( await response.json().catch( () => ( {} ) ) ) as Record< string, unknown >;
		if ( ! response.ok || typeof body.access_token !== 'string' ) {
			throw new Error( `Could not get an app token: ${ response.status } ${ body.error ?? '' }` );
		}
		token = { value: body.access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
		return token.value;
	};

	const call = async (
		method: string,
		route: string,
		signal: AbortSignal,
		body?: Record< string, string >,
		retried = false
	): Promise< Session > => {
		const response = await fetch( `${ apiBase }/wpcom/v2/static-site-import-preview${ route }`, {
			method,
			headers: {
				authorization: `Bearer ${ await bearer( signal ) }`,
				...( body ? { 'content-type': 'application/json' } : {} ),
			},
			body: body ? JSON.stringify( body ) : undefined,
			signal,
		} );
		const json = ( await response.json().catch( () => ( {} ) ) ) as Record< string, unknown >;
		if ( ! response.ok ) {
			// A rejected token is stale rather than wrong: mint a fresh one and try once more.
			if ( response.status === 401 && ! retried ) {
				token = undefined;
				return call( method, route, signal, body, true );
			}
			throw new ApiError(
				String( json.code ?? `http_${ response.status }` ),
				response.status,
				String( json.message ?? response.statusText )
			);
		}
		return json as unknown as Session;
	};

	return {
		create: ( url: string, signal: AbortSignal ) => call( 'POST', '', signal, { source_url: url } ),
		retryable: ( error: unknown ) => error instanceof ApiError && RETRY_CODES.has( error.code ),
		status: ( id: string, signal: AbortSignal ) => call( 'GET', `/${ id }`, signal ),
		revoke: ( id: string, signal: AbortSignal ) => call( 'DELETE', `/${ id }`, signal ),
	};
}

/** Turn a session into job progress. Capture messages carry their own page counts. */
export function progressFrom( session: Session ): JobProgress | undefined {
	const { pages_captured: done, pages_total: total } = session.progress ?? {};
	switch ( session.state ) {
		case 'capture_queued':
			return { step: 'scan', progress: 0.03, detail: 'Waiting for a free slot…' };
		case 'capturing':
			return done && total
				? {
						step: 'capture',
						progress: 0.08 + ( 0.5 * done ) / total,
						detail: `Copied ${ done } of ${ total } pages`,
						counts: { pages: done },
				  }
				: { step: 'scan', progress: 0.05, detail: 'Looking at your site…' };
		case 'building':
			return { step: 'import', progress: 0.68, detail: 'Rebuilding it as WordPress…' };
		case 'preview_ready':
			return { step: 'package', progress: 0.85, detail: 'Packing your WordPress site…' };
		default:
			return undefined;
	}
}

const ENTITIES: Record< string, string > = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = ( text: string ) =>
	text.replace( /&(#\d+|[a-z]+);/gi, ( entity, name: string ) =>
		name.startsWith( '#' )
			? String.fromCodePoint( Number( name.slice( 1 ) ) )
			: ENTITIES[ name.toLowerCase() ] ?? entity
	);

/**
 * The source page's own title, for the headline. WordPress.com reports only bounded
 * counts about a capture, never the site's text, so the name is read here instead.
 * Redirects are followed by hand because every hop has to be a public address too.
 */
export async function fetchTitle( url: string, signal: AbortSignal ) {
	let next = url;
	for ( let hop = 0; hop < 3; hop++ ) {
		const target = new URL( next );
		await assertPublicHost( target.hostname );
		const response = await fetch( target, {
			redirect: 'manual',
			signal: AbortSignal.any( [ signal, AbortSignal.timeout( 10_000 ) ] ),
			headers: { accept: 'text/html' },
		} );
		const location = response.headers.get( 'location' );
		if ( response.status >= 300 && response.status < 400 && location ) {
			next = new URL( location, target ).href;
			continue;
		}
		if ( ! response.ok || ! response.body ) {
			return undefined;
		}
		// The title is in the head, so the rest of the page is never read.
		let head = '';
		for await ( const chunk of response.body ) {
			head += Buffer.from( chunk ).toString( 'utf8' );
			if ( head.length > 64_000 || /<\/title>/i.test( head ) ) {
				break;
			}
		}
		return decode( head.match( /<title[^>]*>([^<]*)</i )?.[ 1 ] ?? '' );
	}
	return undefined;
}

const GENERIC_TITLE = /^(home|home ?page|welcome|index|untitled|imported site)$/i;

/**
 * The site's name from its title, which can be a page title like "Home | Acme Coffee".
 * Undefined when there's no usable name.
 */
export function siteNameFrom( title: unknown ): string | undefined {
	if ( typeof title !== 'string' ) {
		return undefined;
	}
	const name = title
		.split( /\s+[|–—·-]\s+/ )
		.map( ( part ) => part.replace( /\s+/g, ' ' ).trim() )
		.find( ( part ) => part && ! GENERIC_TITLE.test( part ) );
	return name && name.length <= 40 ? name : undefined;
}

/** Stream the archive to disk, returning the SHA-256 of what was written. */
async function download( url: string, target: string, signal: AbortSignal ) {
	const response = await fetch( url, { signal } );
	if ( ! response.ok || ! response.body ) {
		throw new Error( `Could not download the archive: ${ response.status }` );
	}
	const hash = createHash( 'sha256' );
	const bytes = Readable.fromWeb( response.body as Parameters< typeof Readable.fromWeb >[ 0 ] );
	bytes.on( 'data', ( chunk: Buffer ) => hash.update( chunk ) );
	await pump( bytes, fs.createWriteStream( target ), { signal } );
	return hash.digest( 'hex' );
}

function asJobError( error: unknown ) {
	if ( error instanceof ApiError ) {
		if ( error.code === 'invalid_static_site_source_url' ) {
			return new UserError( 'That site needs to be reachable at a public https:// address.' );
		}
		return BUSY_CODES.has( error.code ) || error.status === 429
			? new UserError( BUSY, 503 )
			: error;
	}
	return error;
}

export function createPipeline( config: Config, log: Log ): Runner {
	const api = previewApi( config );

	return async ( job, { filesDir, signal, report } ) => {
		report( { step: 'scan', progress: 0.02, detail: 'Looking at your site…' } );
		// The headline wants the site's own name, and a title that never arrives costs nothing.
		const siteName = await fetchTitle( job.url, signal )
			.then( siteNameFrom )
			.catch( () => undefined );
		if ( siteName ) {
			report( { siteName } );
		}

		// "Busy" and "unavailable" mean another start is in flight or a deploy is passing
		// through, both of which clear on their own.
		const start = async (): Promise< Session > => {
			for ( let attempt = 1; ; attempt++ ) {
				try {
					return await api.create( job.url, signal );
				} catch ( error ) {
					if ( api.retryable( error ) && attempt < 3 ) {
						await sleep( config.pollMs, undefined, { signal } );
						continue;
					}
					log( 'create_failed', { id: job.id, error: String( error ) } );
					throw asJobError( error );
				}
			}
		};
		let session = await start();
		log( 'session_created', { id: job.id, session: session.session_id } );

		try {
			let pages = 0;
			let failures = 0;
			while ( session.state !== 'preview_ready' ) {
				if ( session.state === 'failed' ) {
					log( 'capture_failed', {
						id: job.id,
						session: session.session_id,
						reason: session.receipt?.code,
					} );
					throw new UserError( UNUSABLE_SOURCE );
				}
				await sleep( config.pollMs, undefined, { signal } );
				try {
					session = await api.status( session.session_id, signal );
					failures = 0;
				} catch ( error ) {
					if ( error instanceof ApiError && ++failures <= POLL_FAILURES_ALLOWED ) {
						continue;
					}
					throw asJobError( error );
				}
				const progress = progressFrom( session );
				if ( progress ) {
					pages = progress.counts?.pages ?? pages;
					report( progress );
				}
			}

			if ( ! session.archive_url ) {
				throw new Error( `Session ${ session.session_id } is ready without an archive.` );
			}
			report( { step: 'package', progress: 0.85, detail: 'Packing your WordPress site…' } );
			const siteZip = path.join( filesDir, 'site.zip' );
			const hash = await download( session.archive_url, siteZip, signal );
			if ( session.archive_hash && session.archive_hash !== hash ) {
				throw new Error( `Archive for ${ session.session_id } does not match its hash.` );
			}

			const summary = session.preview_summary ?? {};
			return {
				siteName,
				counts: { pages: summary.pages ?? pages },
				// The importer reports its own verdict rather than refusing the copy, so a
				// site that converted badly is still handed over, with that said plainly.
				warning:
					summary.quality_pass === false || summary.fidelity?.pass === false
						? QUALITY_WARNING
						: undefined,
				files: { site: fs.statSync( siteZip ).size },
			};
		} finally {
			// The copy is on disk, so give the app's slot back rather than waiting for expiry.
			await api.revoke( session.session_id, AbortSignal.timeout( 30_000 ) ).catch( ( error ) =>
				log( 'revoke_failed', {
					id: job.id,
					session: session.session_id,
					error: String( error ),
				} )
			);
		}
	};
}

/**
 * Simulated jobs, for working on the UI without copying real sites. Hosts containing
 * "fail" fail after the scan, and the download is a placeholder.
 */
export const fakePipeline: Runner = async ( job, { filesDir, signal, report } ) => {
	const label = job.host.replace( /^www\./, '' ).split( '.' )[ 0 ];
	const siteName = label.charAt( 0 ).toUpperCase() + label.slice( 1 );
	const state = ( state: Session[ 'state' ], progress?: Session[ 'progress' ] ) =>
		progressFrom( { session_id: 'fake', state, progress } )!;
	report( state( 'capture_queued' ) );
	await sleep( 2_500, undefined, { signal } );
	if ( job.host.includes( 'fail' ) ) {
		throw new UserError( UNUSABLE_SOURCE );
	}
	for ( let done = 1; done <= 21; done++ ) {
		report( { siteName, ...state( 'capturing', { pages_captured: done, pages_total: 21 } ) } );
		await sleep( 400, undefined, { signal } );
	}
	report( state( 'building' ) );
	await sleep( 3_000, undefined, { signal } );
	report( state( 'preview_ready' ) );
	const target = path.join( filesDir, 'site.zip' );
	await fs.promises.writeFile(
		target,
		`A placeholder from a simulated liberate.sh run (LIBERATE_FAKE_PIPELINE=1) for ${ job.url }.\n`
	);
	return { siteName, counts: { pages: 21 }, files: { site: fs.statSync( target ).size } };
};
