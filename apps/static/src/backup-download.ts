import { __ } from '@wordpress/i18n';

// Each chunk has to finish well inside the host's limit on one streamed response.
const CHUNK_SIZE = 16 * 1024 * 1024;
const CHUNK_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;

const BACKUP_PATH = /^\/wpcom\/v2\/sites\/(\d+)\/rewind\/downloads\/(\d+)\/data$/;
const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;

const downloadError = () => new Error( __( 'The backup could not be downloaded.' ) );

async function fetchChunk( path: string, token: string, first: number, signal: AbortSignal ) {
	const response = await fetch( path, {
		headers: {
			'x-backup-token': token,
			'x-backup-range': `bytes=${ first }-${ first + CHUNK_SIZE - 1 }`,
		},
		signal,
	} );
	const [ , start, end, total ] =
		response.headers.get( 'x-backup-content-range' )?.match( CONTENT_RANGE ) ?? [];
	const bytes = new Uint8Array( await response.arrayBuffer() );
	// A stream cut short still ends cleanly, so its size is the only sign.
	if (
		response.status !== 206 ||
		Number( start ) !== first ||
		bytes.length !== Number( end ) - first + 1
	) {
		throw downloadError();
	}
	return { bytes, total: Number( total ) };
}

async function fetchChunkWithRetries(
	path: string,
	token: string,
	first: number,
	signal: AbortSignal
) {
	for ( let attempt = 1; ; attempt++ ) {
		try {
			return await fetchChunk( path, token, first, signal );
		} catch ( error ) {
			signal.throwIfAborted();
			if ( attempt === CHUNK_ATTEMPTS ) {
				throw error;
			}
			await new Promise( ( resolve ) => setTimeout( resolve, RETRY_DELAY_MS * attempt ) );
		}
	}
}

/** Downloads a WordPress.com backup through the static host's `/wpcom-backup` worker. */
export async function downloadBackup(
	downloadUrl: string,
	{ signal, onProgress }: { signal: AbortSignal; onProgress: ( fraction: number ) => void }
): Promise< Uint8Array > {
	const url = new URL( downloadUrl );
	const [ , site, download ] = url.pathname.match( BACKUP_PATH ) ?? [];
	const token = url.searchParams.get( 'token' );
	if ( ! site || ! token ) {
		throw downloadError();
	}

	const path = `/wpcom-backup/${ site }/${ download }/data`;
	const first = await fetchChunkWithRetries( path, token, 0, signal );
	const backup = new Uint8Array( first.total );
	backup.set( first.bytes );
	let received = first.bytes.length;
	onProgress( received / backup.length );
	while ( received < backup.length ) {
		const { bytes } = await fetchChunkWithRetries( path, token, received, signal );
		backup.set( bytes, received );
		received += bytes.length;
		onProgress( received / backup.length );
	}
	return backup;
}
