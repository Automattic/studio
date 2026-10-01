import EventEmitter from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { publishPreviewSite } from './snapshots';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

function fakeCli( run: ( emitter: EventEmitter ) => void ) {
	const emitter = new EventEmitter();
	const execute = vi.fn( () => {
		queueMicrotask( () => run( emitter ) );
		return [ emitter, {} ];
	} ) as unknown as ExecuteCliCommand;
	return execute;
}

describe( 'publishPreviewSite', () => {
	it( 'resolves with the URL the command reports', async () => {
		const execute = fakeCli( ( emitter ) => {
			emitter.emit( 'data', {
				data: { action: 'keyValuePair', key: 'url', value: 'https://preview.example.com' },
			} );
			emitter.emit( 'success' );
		} );

		await expect(
			publishPreviewSite( execute, '/sites/a', 'preview.example.com' )
		).resolves.toEqual( { url: 'https://preview.example.com' } );
		expect( execute ).toHaveBeenCalledWith(
			[ 'preview', 'update', '--path', '/sites/a', 'preview.example.com' ],
			expect.any( Object )
		);
	} );

	it( 'rejects when the command fails or reports no URL', async () => {
		await expect(
			publishPreviewSite(
				fakeCli( ( emitter ) =>
					emitter.emit( 'failure', { error: new Error( 'Upload failed' ) } )
				),
				'/sites/a'
			)
		).rejects.toThrow( 'Upload failed' );
		await expect(
			publishPreviewSite(
				fakeCli( ( emitter ) => emitter.emit( 'success' ) ),
				'/sites/a'
			)
		).rejects.toThrow( 'no URL was returned' );
	} );
} );
