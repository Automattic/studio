import { UserError, assertPublicHost } from './guards.ts';
import type { Config } from './config.ts';
import type { JobRecord } from './store.ts';
import type { JobView } from '../shared.ts';

const SCOPE = 'static-site-import-preview';
/** Tokens last 15 minutes and the response carries no reliable expiry. */
const TOKEN_TTL_MS = 14 * 60_000;
const CALL_TIMEOUT_MS = 30_000;

/** The session fields liberate.sh reads. The endpoint returns more. */
export interface Session {
	session_id: string;
	state: 'capture_queued' | 'capturing' | 'building' | 'preview_ready' | 'failed' | string;
	/** Signed, and refreshed on every read, so it is only ever used right away. */
	archive_url?: string;
	receipt?: { code?: string };
	/** Bounded evidence about the copy: counts, the importer's own verdict, no source text. */
	preview_summary?: {
		pages?: number;
		quality_pass?: boolean;
		fidelity?: { pass?: boolean };
	};
	progress?: {
		finding_pages?: boolean;
		pages_captured?: number;
		pages_total?: number;
	};
}

export interface PreviewClient {
	create( url: string ): Promise< Session >;
	status( id: string ): Promise< Session >;
	revoke( id: string ): Promise< Session >;
	/** The archive's size, so the page can say it before a long download. */
	sizeOf( archiveUrl: string ): Promise< number | undefined >;
}

/** Capacity or a passing deploy, not a bad address. */
const BUSY_CODES = new Set( [
	'static_site_import_preview_daily_limit',
	'static_site_import_session_limit_exceeded',
	'static_site_import_preview_storage_failed',
	'static_site_import_preview_busy',
	'static_site_import_preview_unavailable',
] );

const UNUSABLE_SOURCE = 'We couldn’t copy this site. It may block automated visits.';
const BUSY = 'liberate.sh is at capacity right now. Please try again later.';
const QUALITY_WARNING =
	'Parts of this site didn’t convert cleanly, so some pages may be missing pieces.';

class ApiError extends Error {
	code: string;
	status: number;

	constructor( code: string, status: number, message: string ) {
		super( message );
		this.code = code;
		this.status = status;
	}
}

/** Turn an API refusal into what the visitor should be told. */
export function asUserError( error: unknown ) {
	if ( error instanceof ApiError ) {
		if ( error.code === 'invalid_static_site_source_url' ) {
			return new UserError( 'That site needs to be reachable at a public https:// address.' );
		}
		if ( BUSY_CODES.has( error.code ) || error.status === 429 ) {
			return new UserError( BUSY, 503 );
		}
	}
	return error;
}

/**
 * The WordPress.com preview API, as the registered liberate.sh app: a client-credentials
 * bearer with one scope and no user or blog behind it.
 */
export function previewClient( config: Config ): PreviewClient {
	const { apiBase, wpcom } = config;
	let token: { value: string; expiresAt: number } | undefined;

	const bearer = async ( signal: AbortSignal ) => {
		if ( token && token.expiresAt > Date.now() ) {
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
		body?: Record< string, string >,
		retried = false
	): Promise< Session > => {
		const signal = AbortSignal.timeout( CALL_TIMEOUT_MS );
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
				return call( method, route, body, true );
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
		create: ( url ) => call( 'POST', '', { source_url: url } ),
		status: ( id ) => call( 'GET', `/${ id }` ),
		revoke: ( id ) => call( 'DELETE', `/${ id }` ),
		async sizeOf( archiveUrl ) {
			const response = await fetch( archiveUrl, {
				method: 'HEAD',
				signal: AbortSignal.timeout( CALL_TIMEOUT_MS ),
			} ).catch( () => undefined );
			const length = Number( response?.headers.get( 'content-length' ) );
			return Number.isFinite( length ) && length > 0 ? length : undefined;
		},
	};
}

/** Simulated captures, for working on the page without copying real sites. */
export function fakeClient(): PreviewClient {
	const started = new Map< string, number >();
	const session = ( id: string ): Session => {
		const elapsed = Date.now() - ( started.get( id ) ?? 0 );
		if ( elapsed < 3_000 ) {
			return { session_id: id, state: 'capture_queued' };
		}
		if ( elapsed < 18_000 ) {
			const pages = Math.ceil( ( elapsed - 3_000 ) / 1_000 );
			return {
				session_id: id,
				state: 'capturing',
				progress: { pages_captured: pages, pages_total: 15 },
			};
		}
		if ( elapsed < 24_000 ) {
			return { session_id: id, state: 'building' };
		}
		return {
			session_id: id,
			state: 'preview_ready',
			archive_url: '/api/simulated.zip',
			preview_summary: { pages: 15, quality_pass: false },
		};
	};

	return {
		async create( url ) {
			if ( new URL( url ).hostname.includes( 'fail' ) ) {
				throw new UserError( UNUSABLE_SOURCE );
			}
			const id = Date.now().toString( 16 ).padStart( 32, '0' ).slice( -32 );
			started.set( id, Date.now() );
			return session( id );
		},
		async status( id ) {
			return session( id );
		},
		async revoke( id ) {
			started.delete( id );
			return { session_id: id, state: 'failed' };
		},
		async sizeOf() {
			return 42;
		},
	};
}

/** Where a session's state puts the four steps on the page. */
export function progressFrom( session: Session ) {
	const { pages_captured: done, pages_total: total } = session.progress ?? {};
	switch ( session.state ) {
		case 'capture_queued':
			return { step: 'scan' as const, progress: 0.03, detail: 'Waiting for a free slot…' };
		case 'capturing':
			return done && total
				? {
						step: 'capture' as const,
						progress: 0.08 + ( 0.5 * done ) / total,
						detail: `Copied ${ done } of ${ total } pages`,
						counts: { pages: done },
				  }
				: { step: 'scan' as const, progress: 0.05, detail: 'Looking at your site…' };
		case 'building':
			return { step: 'import' as const, progress: 0.68, detail: 'Rebuilding it as WordPress…' };
		case 'preview_ready':
			return { step: 'package' as const, progress: 1, detail: undefined };
		// Anything unrecognised is still on its way.
		default:
			return { step: 'scan' as const, progress: 0.05, detail: 'Working…' };
	}
}

/** What the page shows: this app's record of the site, and WordPress.com's of the copy. */
export function viewFrom( record: JobRecord, session: Session ): JobView {
	const summary = session.preview_summary ?? {};
	const progress = progressFrom( session );
	const status =
		session.state === 'preview_ready' ? 'done' : session.state === 'failed' ? 'failed' : 'running';
	const pages = summary.pages ?? progress.counts?.pages;

	return {
		id: record.id,
		url: record.url,
		host: record.host,
		siteName: record.siteName,
		status,
		progress: status === 'done' ? 1 : status === 'failed' ? 0 : progress.progress,
		step: status === 'running' ? progress.step : undefined,
		detail: status === 'running' ? progress.detail : undefined,
		counts: pages ? { pages } : undefined,
		warning:
			status === 'done' && ( summary.quality_pass === false || summary.fidelity?.pass === false )
				? QUALITY_WARNING
				: undefined,
		bytes: record.bytes,
		error: status === 'failed' ? UNUSABLE_SOURCE : undefined,
		createdAt: record.createdAt,
		expiresAt: record.expiresAt,
	};
}

const ENTITIES: Record< string, string > = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = ( text: string ) =>
	text.replace( /&(#\d+|[a-z]+);/gi, ( entity, name: string ) =>
		name.startsWith( '#' )
			? String.fromCodePoint( Number( name.slice( 1 ) ) )
			: ENTITIES[ name.toLowerCase() ] ?? entity
	);

/**
 * The source page's own title, for the headline. WordPress.com reports only bounded counts
 * about a capture, never the site's text, so the name is read here instead. Redirects are
 * followed by hand because every hop has to be a public address too.
 */
export async function fetchTitle( url: string ) {
	let next = url;
	for ( let hop = 0; hop < 3; hop++ ) {
		const target = new URL( next );
		await assertPublicHost( target.hostname );
		const response = await fetch( target, {
			redirect: 'manual',
			signal: AbortSignal.timeout( 10_000 ),
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
