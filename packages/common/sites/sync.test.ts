import EventEmitter from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { killChild } from '@studio/common/lib/cli-process';
import { canCancelPull, canCancelPush, isSyncCancelledError } from '@studio/common/lib/sync/cancel';
import { pollImportStatus } from '@studio/common/lib/sync/sync-api';
import { pullSite, pushSite } from './sync';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type { ImportResponse } from '@studio/common/types/sync';

// How the child is killed is platform-specific and covered by
// `lib/tests/cli-process.test.ts`; here we only care that a cancel asks for it.
vi.mock( '@studio/common/lib/cli-process', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/cli-process') >() ),
	killChild: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/sync/sync-api', () => ( {
	initiateImport: vi.fn(),
	pollImportStatus: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/sync/tus-upload', () => ( {
	createTusUpload: vi.fn( () => ( {
		promise: Promise.resolve( 'attachment-1' ),
		abort: vi.fn(),
	} ) ),
} ) );

// Poll back to back rather than waiting 3s between each status.
vi.mock( '@studio/common/lib/sync/constants', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/sync/constants') >() ),
	SYNC_POLL_INTERVAL_MS: 0,
} ) );

describe( 'pullSite', () => {
	it( 'runs the Jetpack-backup `pull` command by default', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;

		const pulling = pullSite( execute, '/sites/local', 42 );
		emitter.emit( 'success' );
		await pulling;

		expect( execute ).toHaveBeenCalledWith(
			[ 'pull', '--path', '/sites/local', '--remote-site', '42', '--options', 'all' ],
			{ output: 'capture' }
		);
	} );

	it( 'runs `pull-reprint` with the same --remote-site identifier for the reprint engine', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;

		const pulling = pullSite( execute, '/sites/local', 42, { engine: 'reprint' } );
		emitter.emit( 'success' );
		await pulling;

		expect( execute ).toHaveBeenCalledWith(
			[ 'pull-reprint', '--path', '/sites/local', '--remote-site', '42' ],
			{ output: 'capture' }
		);
	} );

	// The same selection travels in both engines' forms; reprint reads the
	// wp-content-relative paths and ignores the backup node ids.
	it( 'passes the selection to the reprint engine as --only and --skip-database', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;

		const pulling = pullSite( execute, '/sites/local', 42, {
			engine: 'reprint',
			syncOptions: {
				optionsToSync: [ 'paths' ],
				includePathList: [ 'ZjE6Lw==' ],
				onlyPaths: [ 'plugins/akismet', 'themes' ],
				skipDatabase: true,
			},
		} );
		emitter.emit( 'success' );
		await pulling;

		expect( execute ).toHaveBeenCalledWith(
			[
				'pull-reprint',
				'--path',
				'/sites/local',
				'--remote-site',
				'42',
				'--only=plugins/akismet',
				'--only=themes',
				'--skip-database',
			],
			{ output: 'capture' }
		);
	} );

	it( 'keeps the database and adds no --only when everything is selected', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;

		const pulling = pullSite( execute, '/sites/local', 42, {
			engine: 'reprint',
			syncOptions: { onlyPaths: [], skipDatabase: false },
		} );
		emitter.emit( 'success' );
		await pulling;

		expect( execute ).toHaveBeenCalledWith(
			[ 'pull-reprint', '--path', '/sites/local', '--remote-site', '42' ],
			{ output: 'capture' }
		);
	} );

	it( 'leaves the reprint selection out of a jetpack pull', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( ( _args: string[] ) => [ emitter, {} ] );

		const pulling = pullSite( execute as unknown as ExecuteCliCommand, '/sites/local', 42, {
			syncOptions: { onlyPaths: [ 'plugins/akismet' ], skipDatabase: true },
		} );
		emitter.emit( 'success' );
		await pulling;

		const args = execute.mock.calls[ 0 ][ 0 ];
		expect( args ).not.toContain( '--only=plugins/akismet' );
		expect( args ).not.toContain( '--skip-database' );
	} );

	it( 'forwards live CLI messages and their percentage', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;
		const onProgress = vi.fn();
		const pulling = pullSite( execute, '/sites/local', 42, { emit: onProgress } );

		emitter.emit( 'data', {
			data: {
				action: 'initiateBackup',
				status: 'inprogress',
				message: 'Creating remote backup… (24%)',
			},
		} );
		emitter.emit( 'data', {
			data: {
				action: 'importWpContent',
				status: 'inprogress',
				message: 'Importing media uploads… (3/10)',
			},
		} );
		emitter.emit( 'success' );

		await pulling;
		expect( onProgress ).toHaveBeenNthCalledWith( 1, {
			message: 'Creating remote backup… (24%)',
			progress: 24,
			action: 'initiateBackup',
		} );
		expect( onProgress ).toHaveBeenNthCalledWith( 2, {
			message: 'Importing media uploads… (3/10)',
			action: 'importWpContent',
		} );
	} );

	it( 'kills the CLI and rejects as cancelled when the signal aborts', async () => {
		const emitter = new EventEmitter();
		const child = { pid: 4242 };
		const execute = vi.fn( () => [ emitter, child ] ) as unknown as ExecuteCliCommand;
		const controller = new AbortController();
		const pulling = pullSite( execute, '/sites/local', 42, { signal: controller.signal } );

		controller.abort();

		await expect( pulling ).rejects.toSatisfy( isSyncCancelledError );
		expect( killChild ).toHaveBeenCalledWith( child );
	} );

	it( 'rejects immediately when the signal is already aborted', async () => {
		const execute = vi.fn() as unknown as ExecuteCliCommand;
		await expect(
			pullSite( execute, '/sites/local', 42, { signal: AbortSignal.abort() } )
		).rejects.toSatisfy( isSyncCancelledError );
		expect( execute ).not.toHaveBeenCalled();
	} );

	it( 'passes backup node ids with commas as separate argv values', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => [ emitter, {} ] ) as unknown as ExecuteCliCommand;
		const includePathList = [ 'cjE6,ZjE6Lw==', 'cjI6,ZjI6Lw==', 'ZjM6Lw==' ];
		const pulling = pullSite( execute, '/sites/local', 42, {
			syncOptions: { optionsToSync: [ 'paths' ], includePathList },
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
			],
			{ output: 'capture' }
		);
	} );
} );

describe( 'pushSite', () => {
	function startPush( statuses: ImportResponse[] ) {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => {
			// The handlers are attached right after this returns.
			queueMicrotask( () => emitter.emit( 'success' ) );
			return [ emitter, {} ];
		} ) as unknown as ExecuteCliCommand;

		vi.mocked( pollImportStatus ).mockReset();
		for ( const status of statuses ) {
			vi.mocked( pollImportStatus ).mockResolvedValueOnce( status );
		}

		const emit = vi.fn();
		const pushing = pushSite(
			{ executeCliCommand: execute, accessToken: 'token', emit },
			{ sitePath: '/sites/local', remoteSiteId: 42 }
		);
		return { emit, pushing };
	}

	const working = ( status: string, progress: Partial< ImportResponse > = {} ) =>
		( {
			status,
			success: true,
			backup_progress: null,
			import_progress: null,
			...progress,
		} ) as ImportResponse;

	it( 'polls the remote import to completion instead of resolving once it starts', async () => {
		const { emit, pushing } = startPush( [
			working( 'initial_backup_started', { backup_progress: 40 } ),
			working( 'archive_import_started', { import_progress: 20 } ),
			working( 'archive_import_finished' ),
			working( 'finished' ),
		] );

		await pushing;

		// Resolving at initiate — the bug — would stop this list at the first
		// `creatingRemoteBackup`, before any of the polled phases.
		expect( emit.mock.calls.map( ( [ output ] ) => output ) ).toEqual( [
			{ kind: 'phase', phase: 'creatingBackup' },
			{ kind: 'phase', phase: 'uploading' },
			{ kind: 'phase', phase: 'creatingRemoteBackup' },
			{ kind: 'phase', phase: 'creatingRemoteBackup', progress: 40 },
			{ kind: 'phase', phase: 'applyingChanges', progress: 20 },
			{ kind: 'phase', phase: 'finishing' },
		] );
		expect( pollImportStatus ).toHaveBeenCalledTimes( 4 );
	} );

	it( 'rejects with the reason the remote import failed', async () => {
		const failure = ( error: string, vp_restore_message: string | null = null ): ImportResponse =>
			( {
				status: 'failed',
				success: false,
				error,
				error_data: { vp_restore_status: null, vp_restore_message, vp_rewind_id: null },
			} ) as ImportResponse;

		await expect(
			startPush( [ failure( 'Import failed', 'Error importing SQL dump' ) ] ).pushing
		).rejects.toThrow( /database failed to import/i );

		await expect( startPush( [ failure( 'Import timed out' ) ] ).pushing ).rejects.toThrow(
			/timed out while importing/i
		);

		await expect( startPush( [ failure( 'Something else' ) ] ).pushing ).rejects.toThrow(
			/went wrong while updating the live site/i
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
