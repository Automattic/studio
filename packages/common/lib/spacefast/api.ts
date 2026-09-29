import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
	SpacefastAuth,
	SpacefastDeviceLogin,
	SpacefastSpace,
	SpacefastTeam,
} from '@studio/common/types/spacefast';

const API_URL = process.env.SPACEFAST_API_URL ?? 'https://api.spacefast.com';
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

// Retries requests that never reached Spacefast (DNS, connection resets, timeouts).
// POSTs carry an Idempotency-Key, so a retry never applies twice.
async function fetchWithRetry( url: URL, init: RequestInit ): Promise< Response > {
	for ( let attempt = 1; ; attempt++ ) {
		try {
			return await fetch( url, init );
		} catch ( error ) {
			if ( attempt >= NETWORK_RETRIES ) {
				// Node's fetch reports the actual network failure as the error's `cause`.
				const { cause } = error as { cause?: { message?: string } };
				throw new SpacefastApiError(
					`Could not reach ${ url.host }: ${ cause?.message ?? String( error ) }`,
					0,
					'network_error'
				);
			}
			await new Promise( ( resolve ) => setTimeout( resolve, attempt * 2000 ) );
		}
	}
}

async function request< T >(
	route: string,
	{
		apiKey,
		method = 'GET',
		body,
		headers,
	}: { apiKey?: string; method?: string; body?: unknown; headers?: Record< string, string > } = {}
): Promise< T > {
	const response = await fetchWithRetry( new URL( route, API_URL ), {
		method,
		headers: {
			...( apiKey ? { Authorization: `Bearer ${ apiKey }` } : {} ),
			...( body === undefined ? {} : { 'Content-Type': 'application/json' } ),
			...( method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {} ),
			...headers,
		},
		body: body === undefined ? undefined : JSON.stringify( body ),
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

// Device login: the user approves the request in the browser, and the poll then redeems
// an API key. No redirect URI is involved, so it works for the desktop app, `studio ui`
// and the CLI alike.
export async function startSpacefastDeviceLogin(): Promise< SpacefastDeviceLogin > {
	const { data } = await request< { data: SpacefastDeviceLogin } >( '/v1/auth/device', {
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

export async function waitForSpacefastDeviceLogin(
	login: SpacefastDeviceLogin,
	signal?: AbortSignal
): Promise< SpacefastAuth > {
	while ( Date.now() < Date.parse( login.expiresAt ) ) {
		signal?.throwIfAborted();
		const { data } = await request< {
			data: { status: string; apiKey?: { secret: string; expiresAt: string | null } };
		} >( '/v1/auth/device/poll', { method: 'POST', body: { deviceCode: login.deviceCode } } );
		if ( data.status === 'approved' && data.apiKey ) {
			return { apiKey: data.apiKey.secret, expiresAt: data.apiKey.expiresAt };
		}
		if ( data.status !== 'pending' ) {
			throw new SpacefastApiError( `Spacefast sign-in was ${ data.status }.`, 403, data.status );
		}
		await new Promise( ( resolve ) => setTimeout( resolve, login.interval * 1000 ) );
	}
	throw new SpacefastApiError( 'Spacefast sign-in expired.', 403, 'expired' );
}

export async function listSpacefastTeams( apiKey: string ): Promise< SpacefastTeam[] > {
	const teams = await listAll< { id: string; name: string } >( '/v1/teams', apiKey );
	return teams.map( ( { id, name } ) => ( { id, name } ) );
}

type ApiSpace = { id: string; title: string; slug: string; liveUrl: string; teamId: string };

export async function listSpacefastSpaces( apiKey: string ): Promise< SpacefastSpace[] > {
	const spaces: SpacefastSpace[] = [];
	for ( const team of await listSpacefastTeams( apiKey ) ) {
		const teamSpaces = await listAll< ApiSpace >(
			`/v1/teams/${ encodeURIComponent( team.id ) }/spaces`,
			apiKey
		);
		spaces.push(
			...teamSpaces.map( ( space ) => ( { ...toSpace( space ), teamName: team.name } ) )
		);
	}
	return spaces;
}

export async function createSpacefastSpace(
	apiKey: string,
	{ teamId, title }: { teamId: string; title: string }
): Promise< Omit< SpacefastSpace, 'teamName' > > {
	const { data } = await request< { data: { space: ApiSpace } } >( '/v1/spaces', {
		apiKey,
		method: 'POST',
		// A published site is meant to be visited; existing Spaces keep their own access.
		body: { teamId, title, access: 'public' },
	} );
	return toSpace( data.space );
}

export async function getSpacefastSpace(
	apiKey: string,
	spaceId: string
): Promise< Omit< SpacefastSpace, 'teamName' > > {
	const { data } = await request< { data: ApiSpace } >(
		`/v1/spaces/${ encodeURIComponent( spaceId ) }`,
		{ apiKey }
	);
	return toSpace( data );
}

function toSpace( { id, title, slug, liveUrl, teamId }: ApiSpace ) {
	return { id, title, slug, liveUrl, teamId };
}

type UploadTarget = {
	path: string;
	method: string;
	url: string;
	headers?: Record< string, string >;
};
type Upload = { summary: { upload: number }; targets: UploadTarget[] } | null;
type VersionUpload = { data: { versionId: string | null; upload: Upload } };

// Publishes a directory as a new live version of a Space. Only files whose content
// changed since the previous version are uploaded.
export async function publishDirectoryToSpacefast(
	apiKey: string,
	spaceId: string,
	directory: string,
	onProgress?: ( progress: { uploaded: number; total: number } ) => void
): Promise< { versionId: string | null } > {
	const spaceRoute = `/v1/spaces/${ encodeURIComponent( spaceId ) }`;
	const files = await buildManifest( directory );
	const {
		data: { versionId, upload: firstUpload },
	} = await request< VersionUpload >( `${ spaceRoute }/versions`, {
		apiKey,
		method: 'POST',
		body: {
			publishMode: 'snapshot',
			files,
			source: { kind: 'api', client: CLIENT_ID, message: 'Published from WordPress Studio' },
		},
	} );
	// No version means the files are identical to the live version.
	if ( ! versionId ) {
		return { versionId: null };
	}

	const total = firstUpload?.summary.upload ?? 0;
	let uploaded = 0;
	let upload = firstUpload;
	onProgress?.( { uploaded, total } );
	for ( let page = 0; upload?.targets.length; page++ ) {
		if ( page >= MAX_UPLOAD_PAGES ) {
			throw new SpacefastApiError( 'Spacefast kept requesting uploads.', 500 );
		}
		const targets = [ ...upload.targets ];
		let expired = false;
		await Promise.all(
			Array.from( { length: UPLOAD_CONCURRENCY }, async () => {
				for ( let target = targets.shift(); target && ! expired; target = targets.shift() ) {
					const status = await uploadFile( directory, target );
					if ( status === 401 || status === 403 ) {
						expired = true;
					} else {
						onProgress?.( { uploaded: ++uploaded, total } );
					}
				}
			} )
		);
		// Targets come in pages and expire, so ask for the remaining ones until none are left.
		( { upload } = (
			await request< VersionUpload >( `${ spaceRoute }/versions/${ versionId }/uploads/refresh`, {
				apiKey,
				method: 'POST',
			} )
		).data );
	}

	await request( `${ spaceRoute }/versions/${ versionId }/finalize`, {
		apiKey,
		method: 'POST',
		body: { channel: 'live' },
	} );
	await waitForLiveVersion( apiKey, spaceRoute, versionId );
	return { versionId };
}

async function buildManifest( directory: string ) {
	const entries = await fs.promises.readdir( directory, { recursive: true, withFileTypes: true } );
	const files = [];
	for ( const entry of entries ) {
		if ( ! entry.isFile() ) {
			continue;
		}
		const absolute = path.join( entry.parentPath, entry.name );
		const content = await fs.promises.readFile( absolute );
		files.push( {
			path: path.relative( directory, absolute ).split( path.sep ).join( '/' ),
			size: content.length,
			sha256: crypto.createHash( 'sha256' ).update( content ).digest( 'hex' ),
		} );
	}
	return files.sort( ( a, b ) => a.path.localeCompare( b.path ) );
}

async function uploadFile( directory: string, target: UploadTarget ): Promise< number > {
	const file = path.resolve( directory, target.path );
	if ( ! file.startsWith( path.resolve( directory ) + path.sep ) ) {
		throw new SpacefastApiError(
			`Spacefast requested a file outside the export: ${ target.path }`,
			400
		);
	}
	const response = await fetchWithRetry( new URL( target.url, API_URL ), {
		method: target.method,
		headers: target.headers,
		body: await fs.promises.readFile( file ),
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

async function waitForLiveVersion( apiKey: string, spaceRoute: string, versionId: string ) {
	const deadline = Date.now() + VERSION_POLL_TIMEOUT_MS;
	while ( Date.now() < deadline ) {
		const { data } = await request< {
			data: { status: string; failureMessage: string | null };
		} >( `${ spaceRoute }/versions/${ versionId }`, { apiKey } );
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
		await new Promise( ( resolve ) => setTimeout( resolve, VERSION_POLL_INTERVAL_MS ) );
	}
	throw new SpacefastApiError( 'Timed out waiting for Spacefast to publish the version.', 504 );
}
