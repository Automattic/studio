import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import { isErrnoException } from './is-errno-exception.ts';

export async function downloadFile(
	url: string,
	destinationPath: string,
	onProgress?: ( downloaded: number, total: number ) => void,
	{ stallTimeoutMs }: { stallTimeoutMs?: number } = {}
): Promise< void > {
	// Stops a download that stops receiving data, however long it has been running,
	// so a network that hangs instead of failing can't hold up the caller. A slow
	// connection that keeps sending finishes.
	const controller = new AbortController();
	let stallTimer: NodeJS.Timeout | undefined;
	const resetStallTimer = () => {
		if ( stallTimeoutMs === undefined ) {
			return;
		}
		clearTimeout( stallTimer );
		stallTimer = setTimeout(
			() =>
				controller.abort(
					new Error( `Download stalled: no data received for ${ stallTimeoutMs / 1000 }s` )
				),
			stallTimeoutMs
		);
	};
	resetStallTimer();
	try {
		await download( url, destinationPath, onProgress, controller.signal, resetStallTimer );
	} finally {
		clearTimeout( stallTimer );
	}
}

async function download(
	url: string,
	destinationPath: string,
	onProgress: ( ( downloaded: number, total: number ) => void ) | undefined,
	signal: AbortSignal,
	onData: () => void
): Promise< void > {
	try {
		await fs.promises.mkdir( path.dirname( destinationPath ), { recursive: true } );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code !== 'EEXIST' ) {
			throw error;
		}
	}

	const response = await fetch( url, { signal } );
	if ( ! response.ok ) {
		throw new Error( `Request failed with status code: ${ response.status }` );
	}
	if ( ! response.body ) {
		throw new Error( 'Download response did not include a readable body.' );
	}
	const body = response.body.pipeThrough(
		new TransformStream< Uint8Array, Uint8Array >( {
			transform( chunk, controller ) {
				onData();
				controller.enqueue( chunk );
			},
		} )
	);

	if ( ! onProgress ) {
		await body.pipeTo( Writable.toWeb( fs.createWriteStream( destinationPath ) ) );
		return;
	}

	const total = Number( response.headers.get( 'content-length' ) ) || 0;
	let downloaded = 0;
	const PROGRESS_CHUNK = 512 * 1024; // report every 512 KB
	let nextReport = PROGRESS_CHUNK;

	const writer = fs.createWriteStream( destinationPath );
	const reader = body.getReader();
	try {
		while ( true ) {
			const { done, value } = await reader.read();
			if ( done ) break;
			writer.write( value );
			downloaded += value.byteLength;
			if ( downloaded >= nextReport ) {
				onProgress( downloaded, total );
				nextReport = downloaded + PROGRESS_CHUNK;
			}
		}
	} finally {
		reader.releaseLock();
		await new Promise< void >( ( resolve, reject ) => {
			writer.end( ( err: Error | null | undefined ) => ( err ? reject( err ) : resolve() ) );
		} );
	}
	onProgress( downloaded, total );
}
