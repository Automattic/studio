import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadFile } from '../download-file';

// Serves a 4-chunk body, waiting `gapMs` between chunks; `stallAfter` chunks are
// sent and then the response goes silent without ending.
function serve( { gapMs, stallAfter }: { gapMs: number; stallAfter?: number } ) {
	return new Promise< { url: string; close: () => void } >( ( resolve ) => {
		const server = http.createServer( async ( _request, response ) => {
			response.writeHead( 200, { 'content-length': '4' } );
			for ( let chunk = 0; chunk < 4; chunk++ ) {
				if ( chunk === stallAfter ) {
					return;
				}
				response.write( 'x' );
				await new Promise( ( done ) => setTimeout( done, gapMs ) );
			}
			response.end();
		} );
		server.listen( 0, '127.0.0.1', () => {
			const { port } = server.address() as { port: number };
			resolve( {
				url: `http://127.0.0.1:${ port }/file`,
				close: () => server.close() && server.closeAllConnections(),
			} );
		} );
	} );
}

describe( 'downloadFile stall timeout', () => {
	let dir: string;
	beforeEach( () => {
		dir = fs.mkdtempSync( path.join( os.tmpdir(), 'download-file-' ) );
	} );
	afterEach( () => {
		fs.rmSync( dir, { recursive: true, force: true } );
	} );

	it.each( [
		{ name: 'stops a download that goes silent', gapMs: 10, stallAfter: 2, completes: false },
		{ name: 'stops a request that never answers', gapMs: 10, stallAfter: 0, completes: false },
		// 4 chunks 150ms apart take longer than the 250ms timeout in total.
		{ name: 'finishes a slow download that keeps sending', gapMs: 150, completes: true },
	] )( '$name', async ( { gapMs, stallAfter, completes } ) => {
		const server = await serve( { gapMs, stallAfter } );
		const destination = path.join( dir, 'file' );
		try {
			const result = downloadFile( server.url, destination, undefined, { stallTimeoutMs: 250 } );
			if ( completes ) {
				await result;
				expect( fs.readFileSync( destination, 'utf8' ) ).toBe( 'xxxx' );
			} else {
				await expect( result ).rejects.toThrow( 'Download stalled: no data received for 0.25s' );
			}
		} finally {
			server.close();
		}
	} );
} );
