import EventEmitter from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { killChild } from '@studio/common/lib/cli-process';
import { canCancelPull, canCancelPush, isSyncCancelledError } from '@studio/common/lib/sync/cancel';
import { pullSite, pushSite } from './sync';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

// How the child is killed is platform-specific and covered by
// `lib/tests/cli-process.test.ts`; here we only care that a cancel asks for it.
vi.mock( '@studio/common/lib/cli-process', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/cli-process') >() ),
	killChild: vi.fn(),
} ) );

function fakeCli() {
	const emitter = new EventEmitter();
	const child = { pid: 4242 };
	const execute = vi.fn( () => [ emitter, child ] ) as unknown as ExecuteCliCommand;
	return { emitter, child, execute };
}

describe( 'pullSite', () => {
	it( 'kills the CLI and rejects as cancelled when the signal aborts', async () => {
		const { child, execute } = fakeCli();
		const controller = new AbortController();
		const pulling = pullSite( execute, '/sites/local', 42, undefined, controller.signal );

		controller.abort();

		await expect( pulling ).rejects.toSatisfy( isSyncCancelledError );
		expect( killChild ).toHaveBeenCalledWith( child );
	} );

	it( 'rejects immediately when the signal is already aborted', async () => {
		const { execute } = fakeCli();
		await expect(
			pullSite( execute, '/sites/local', 42, undefined, AbortSignal.abort() )
		).rejects.toSatisfy( isSyncCancelledError );
		expect( execute ).not.toHaveBeenCalled();
	} );

	it( 'passes backup node ids with commas as separate argv values', async () => {
		const { emitter, execute } = fakeCli();
		const includePathList = [ 'cjE6,ZjE6Lw==', 'cjI6,ZjI6Lw==', 'ZjM6Lw==' ];
		const pulling = pullSite( execute, '/sites/local', 42, {
			optionsToSync: [ 'paths' ],
			includePathList,
		} );

		emitter.emit( 'success' );
		await pulling;

		expect( execute ).toHaveBeenCalledWith(
			[
				'pull',
				'--path',
				'/sites/local',
				'--remote-site',
				'42',
				'--options',
				'paths',
				'--include-path-list',
				...includePathList,
				'--suppress-tracks-event',
			],
			{ output: 'capture' }
		);
	} );
} );

describe( 'pushSite', () => {
	it( 'runs the CLI push with the selection and rejects with its error', async () => {
		const { emitter, execute } = fakeCli();
		const pushing = pushSite( execute, '/sites/local', 42, {
			optionsToSync: [ 'themes' ],
			specificSelectionPaths: [ 'wp-content/themes/twentytwentyfive' ],
		} );

		emitter.emit( 'failure', { error: new Error( 'Upload failed' ) } );

		await expect( pushing ).rejects.toThrow( 'Upload failed' );
		expect( execute ).toHaveBeenCalledWith(
			[
				'push',
				'--path',
				'/sites/local',
				'--remote-site',
				'42',
				'--options',
				'themes',
				'--include-only',
				'wp-content/themes/twentytwentyfive',
				'--suppress-tracks-event',
			],
			{ output: 'capture' }
		);
	} );
} );

describe( 'cancellable phases', () => {
	it( 'allows stopping a push until the remote import is initiated', () => {
		expect( canCancelPush( 'creatingBackup' ) ).toBe( true );
		expect( canCancelPush( 'uploading' ) ).toBe( true );
		expect( canCancelPush( undefined ) ).toBe( true );

		// Everything from the import onwards is the live site being rebuilt.
		expect( canCancelPush( 'creatingRemoteBackup' ) ).toBe( false );
		expect( canCancelPush( 'applyingChanges' ) ).toBe( false );
		expect( canCancelPush( 'finishing' ) ).toBe( false );
	} );

	it( 'allows stopping a pull until the CLI starts writing the local site', () => {
		// Everything the CLI does before the first local write, in the order it
		// reports it — a pull is cancellable throughout.
		expect( canCancelPull( undefined ) ).toBe( true );
		expect( canCancelPull( 'startDaemon' ) ).toBe( true );
		expect( canCancelPull( 'loadSites' ) ).toBe( true );
		expect( canCancelPull( 'fetchRemoteSites' ) ).toBe( true );
		expect( canCancelPull( 'initiateBackup' ) ).toBe( true );
		expect( canCancelPull( 'download' ) ).toBe( true );

		// `stopSite` is the first local write; the import actions after it come
		// from another logger enum, so anything unrecognised is refused too.
		expect( canCancelPull( 'stopSite' ) ).toBe( false );
		expect( canCancelPull( 'extractBackup' ) ).toBe( false );
		expect( canCancelPull( 'importDatabase' ) ).toBe( false );
		expect( canCancelPull( 'startSite' ) ).toBe( false );
	} );

	it( 'recognises a cancelled sync through IPC and HTTP error wrapping', () => {
		expect( isSyncCancelledError( new Error( 'STUDIO_SYNC_CANCELLED' ) ) ).toBe( true );
		expect(
			isSyncCancelledError(
				new Error( "Error invoking remote method 'pushSiteToLive': Error: STUDIO_SYNC_CANCELLED" )
			)
		).toBe( true );
		expect( isSyncCancelledError( new Error( 'Remote backup failed' ) ) ).toBe( false );
	} );
} );
