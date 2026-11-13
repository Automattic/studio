import type { Space } from './site';
import type { DeviceAuthorization, PushFile } from '../types';

const API_URL = 'https://api.spacefast.com';
const CLIENT_ID = 'wordpress-studio';
const UPLOAD_CONCURRENCY = 6;
const VERSION_POLL_INTERVAL_MS = 1000;
const VERSION_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_UPLOAD_PAGES = 1000;
const NETWORK_RETRIES = 3;

export class SpacefastApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string
	) {
		super( message );
		this.name = 'SpacefastApiError';
	}
}

function sleep( ms: number, signal?: AbortSignal ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const timer = setTimeout( resolve, ms );
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout( timer );
				reject( signal.reason );
			},
			{ once: true }
		);
	} );
}

// Retries requests that never reached Spacefast (DNS, connection resets, timeouts).
// POSTs carry an Idempotency-Key, so a retry never applies twice.
async function fetchWithRetry( url: URL, init: RequestInit ): Promise< Response > {
	for ( let attempt = 1; ; attempt++ ) {
		try {
			return await fetch( url, init );
		} catch ( error ) {
			if ( init.signal?.aborted ) {
				throw error;
			}
			if ( attempt >= NETWORK_RETRIES ) {
				// Node's fetch reports the actual network failure as the error's `cause`.
				const { cause } = error as { cause?: { message?: string } };
				throw new SpacefastApiError(
					`Could not reach ${ url.host }: ${ cause?.message ?? String( error ) }`,
					0,
					'network_error'
				);
			}
			await sleep( attempt * 2000 );
		}
	}
}

export async function request< T >(
	route: string,
	{
		apiKey,
		method = 'GET',
		body,
		signal,
	}: { apiKey?: string; method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise< T > {
	const response = await fetchWithRetry( new URL( route, API_URL ), {
		method,
		headers: {
			...( apiKey ? { Authorization: `Bearer ${ apiKey }` } : {} ),
			...( body === undefined ? {} : { 'Content-Type': 'application/json' } ),
			...( method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {} ),
		},
		body: body === undefined ? undefined : JSON.stringify( body ),
		signal,
	} );
	const json = await response.json().catch( () => null );
	if ( ! response.ok ) {
		// Errors are RFC 9457 problem documents.
		throw new SpacefastApiError(
			json?.detail ?? json?.title ?? `Spacefast request failed with status ${ response.status }`,
			response.status,
			json?.code
		);
	}
	return json as T;
}

async function listAll< T >( route: string, apiKey: string ): Promise< T[] > {
	const items: T[] = [];
	let cursor: string | null = null;
	do {
		const query: string = cursor ? `?cursor=${ encodeURIComponent( cursor ) }` : '';
		const page: { data: T[]; pagination?: { nextCursor: string | null } } = await request(
			route + query,
			{ apiKey }
		);
		items.push( ...page.data );
		cursor = page.pagination?.nextCursor ?? null;
	} while ( cursor );
	return items;
}

// Device login: the user approves the code in the browser while Studio polls, and the approval
// redeems an API key. No redirect is involved, so it works in every app and the CLI alike.
export async function startDeviceLogin(): Promise< DeviceAuthorization > {
	const { data } = await request< { data: DeviceAuthorization } >( '/v1/auth/device', {
		method: 'POST',
		// `clientId` only accepts clients registered with Spacefast; Studio isn't one yet.
		body: { access: 'agent' },
	} );
	const verificationUrl = new URL( data.verificationUrl );
	if ( ! verificationUrl.searchParams.has( 'user_code' ) ) {
		verificationUrl.searchParams.set( 'user_code', data.userCode.replace( /-/g, '' ) );
	}
	return { ...data, verificationUrl: verificationUrl.toString() };
}

export async function waitForDeviceLogin( login: {
	deviceCode: string;
	interval: number;
	expiresAt: string;
} ): Promise< { apiKey: string; expiresAt: string | null } > {
	while ( Date.now() < Date.parse( login.expiresAt ) ) {
		const { data } = await request< {
			data: { status: string; apiKey?: { secret: string; expiresAt: string | null } };
		} >( '/v1/auth/device/poll', { method: 'POST', body: { deviceCode: login.deviceCode } } );
		if ( data.status === 'approved' && data.apiKey ) {
			return { apiKey: data.apiKey.secret, expiresAt: data.apiKey.expiresAt };
		}
		if ( data.status !== 'pending' ) {
			throw new SpacefastApiError( `Spacefast sign-in was ${ data.status }.`, 403, data.status );
		}
		await sleep( login.interval * 1000 );
	}
	throw new SpacefastApiError( 'Spacefast sign-in expired.', 403, 'expired' );
}

type ApiSpace = { id: string; title: string; slug: string; liveUrl: string; teamId: string };

function toSpace( { id, title, slug, liveUrl, teamId }: ApiSpace ): Space {
	return { id, name: title, slug, url: liveUrl, teamId };
}

export async function listTeams(
	apiKey: string
): Promise< { id: string; name: string; slug?: string }[] > {
	const teams = await listAll< { id: string; name: string; slug?: string } >( '/v1/teams', apiKey );
	return teams.map( ( { id, name, slug } ) => ( { id, name, slug } ) );
}

export async function listSpaces( apiKey: string ): Promise< Space[] > {
	const spaces: Space[] = [];
	for ( const team of await listTeams( apiKey ) ) {
		const teamSpaces = await listAll< ApiSpace >(
			`/v1/teams/${ encodeURIComponent( team.id ) }/spaces`,
			apiKey
		);
		spaces.push(
			...teamSpaces.map( ( space ) => ( {
				...toSpace( space ),
				teamName: team.name,
				teamSlug: team.slug,
			} ) )
		);
	}
	return spaces;
}

export async function createSpace(
	apiKey: string,
	{ teamId, title }: { teamId: string; title: string }
): Promise< Space > {
	const { data } = await request< { data: { space: ApiSpace } } >( '/v1/spaces', {
		apiKey,
		method: 'POST',
		// A published site is meant to be visited; existing Spaces keep their own access.
		body: { teamId, title, access: 'public' },
	} );
	return toSpace( data.space );
}

type UploadTarget = {
	path: string;
	method: string;
	url: string;
	headers?: Record< string, string >;
};
type Upload = { summary: { upload: number }; targets: UploadTarget[] } | null;
type VersionUpload = { data: { versionId: string | null; upload: Upload } };

async function sha256( bytes: Uint8Array ): Promise< string > {
	const digest = await crypto.subtle.digest( 'SHA-256', bytes as BufferSource );
	return Array.from( new Uint8Array( digest ), ( byte ) =>
		byte.toString( 16 ).padStart( 2, '0' )
	).join( '' );
}

// Publishes the files as a new live version of a Space. Only files whose content changed since the
// previous version are uploaded. Resolves with null when nothing changed.
export async function publishFiles(
	apiKey: string,
	spaceId: string,
	files: PushFile[],
	onProgress: ( progress: { stage: 'uploading' | 'finishing'; percent?: number } ) => void,
	signal?: AbortSignal
): Promise< { versionId: string | null } > {
	const spaceRoute = `/v1/spaces/${ encodeURIComponent( spaceId ) }`;
	const byPath = new Map( files.map( ( file ) => [ file.path, file ] ) );
	const manifest = [];
	for ( const file of [ ...files ].sort( ( a, b ) => a.path.localeCompare( b.path ) ) ) {
		signal?.throwIfAborted();
		manifest.push( {
			path: file.path,
			size: file.size,
			sha256: await sha256( await file.read() ),
		} );
	}

	const {
		data: { versionId, upload: firstUpload },
	} = await request< VersionUpload >( `${ spaceRoute }/versions`, {
		apiKey,
		method: 'POST',
		body: {
			publishMode: 'snapshot',
			files: manifest,
			source: { kind: 'api', client: CLIENT_ID, message: 'Published from WordPress Studio' },
		},
		signal,
	} );
	// No version means the files are identical to the live version.
	if ( ! versionId ) {
		return { versionId: null };
	}

	const total = firstUpload?.summary.upload ?? 0;
	let uploaded = 0;
	let upload = firstUpload;
	// Pages in a row that uploaded nothing: refused targets that refreshing doesn't fix.
	let stalled = 0;
	onProgress( { stage: 'uploading', percent: 0 } );
	for ( let page = 0; upload?.targets.length; page++ ) {
		if ( page >= MAX_UPLOAD_PAGES ) {
			throw new SpacefastApiError( 'Spacefast kept requesting uploads.', 500 );
		}
		const targets = [ ...upload.targets ];
		const before = uploaded;
		let expired = false;
		await Promise.all(
			Array.from( { length: UPLOAD_CONCURRENCY }, async () => {
				for ( let target = targets.shift(); target && ! expired; target = targets.shift() ) {
					const status = await uploadFile( byPath, target, signal );
					if ( status === 401 || status === 403 ) {
						expired = true;
					} else {
						uploaded++;
						onProgress( {
							stage: 'uploading',
							percent: total ? Math.min( 100, ( uploaded / total ) * 100 ) : 100,
						} );
					}
				}
			} )
		);
		stalled = uploaded === before ? stalled + 1 : 0;
		if ( stalled > NETWORK_RETRIES ) {
			throw new SpacefastApiError( 'Spacefast kept refusing the uploads.', 502 );
		}
		// Targets come in pages and expire, so ask for the remaining ones until none are left.
		( { upload } = (
			await request< VersionUpload >( `${ spaceRoute }/versions/${ versionId }/uploads/refresh`, {
				apiKey,
				method: 'POST',
				signal,
			} )
		).data );
	}

	onProgress( { stage: 'finishing' } );
	await request( `${ spaceRoute }/versions/${ versionId }/finalize`, {
		apiKey,
		method: 'POST',
		body: { channel: 'live' },
		signal,
	} );
	await waitForLiveVersion( apiKey, spaceRoute, versionId, signal );
	return { versionId };
}

async function uploadFile(
	files: Map< string, PushFile >,
	target: UploadTarget,
	signal?: AbortSignal
): Promise< number > {
	const file = files.get( target.path );
	if ( ! file ) {
		throw new SpacefastApiError(
			`Spacefast requested a file that isn't in the export: ${ target.path }`,
			400
		);
	}
	const response = await fetchWithRetry( new URL( target.url, API_URL ), {
		method: target.method,
		headers: target.headers,
		body: ( await file.read() ) as BodyInit,
		signal,
	} );
	const text = await response.text().catch( () => '' );
	if ( ! response.ok && response.status !== 401 && response.status !== 403 ) {
		throw new SpacefastApiError(
			`Uploading ${ target.path } failed (${ response.status }): ${ text.slice( 0, 300 ) }`,
			response.status
		);
	}
	return response.status;
}

async function waitForLiveVersion(
	apiKey: string,
	spaceRoute: string,
	versionId: string,
	signal?: AbortSignal
) {
	const deadline = Date.now() + VERSION_POLL_TIMEOUT_MS;
	while ( Date.now() < deadline ) {
		const { data } = await request< {
			data: { status: string; failureMessage: string | null };
		} >( `${ spaceRoute }/versions/${ versionId }`, { apiKey, signal } );
		if ( data.status === 'ready' ) {
			return;
		}
		if ( [ 'failed', 'canceled', 'expired' ].includes( data.status ) ) {
			throw new SpacefastApiError(
				data.failureMessage ?? `Spacefast could not publish the version (${ data.status }).`,
				500,
				data.status
			);
		}
		await sleep( VERSION_POLL_INTERVAL_MS, signal );
	}
	throw new SpacefastApiError( 'Timed out waiting for Spacefast to publish the version.', 504 );
}
