import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteSiteError } from '../../../errors';
import {
	fetchLatestRewindId,
	initiateBackup,
	initiateImport,
	launchSite,
	pollImportStatus,
} from '../api';
import { wpcomSites } from '../index';
import { createTusUpload } from '../upload';

vi.mock( '../api' );
vi.mock( '../upload' );

const config = { token: 'token' };

// Mirrors the error wpcom-xhr-request builds from a `{ success: false, error }` 500 body.
function wpcomError( body?: { success: boolean; error: string } ) {
	return Object.assign(
		new Error( '500 status code for "POST /sites/42/studio-app/sync/backup"' ),
		{ statusCode: 500, ...body }
	);
}

beforeEach( () => {
	vi.resetAllMocks();
} );

describe( 'pull.backup', () => {
	it( "keeps the server's error text in the cause", async () => {
		vi.mocked( initiateBackup ).mockRejectedValue(
			wpcomError( { success: false, error: 'Site does not exist' } )
		);

		const error = await wpcomSites
			.pull!.backup( config, { id: 42 }, {}, () => {} )
			.catch( ( e: unknown ) => e );

		expect( error ).toBeInstanceOf( RemoteSiteError );
		expect( error ).toMatchObject( {
			message: 'Failed to initiate backup',
			code: 'remote_backup',
		} );
		expect( ( error as RemoteSiteError ).cause ).toMatchObject( {
			message: '500 status code for "POST /sites/42/studio-app/sync/backup" (Site does not exist)',
		} );
	} );

	it( 'keeps the status line alone when the server sends no error text', async () => {
		vi.mocked( initiateBackup ).mockRejectedValue( wpcomError() );

		const error = await wpcomSites
			.pull!.backup( config, { id: 42 }, {}, () => {} )
			.catch( ( e: unknown ) => e );

		expect( ( error as RemoteSiteError ).cause ).toMatchObject( {
			message: '500 status code for "POST /sites/42/studio-app/sync/backup"',
		} );
	} );
} );

describe( 'pull.latestBackupId', () => {
	it.each( [
		Object.assign( new Error( 'Precondition Failed' ), {
			statusCode: 412,
			error: 'rest_forbidden',
		} ),
		new Error( 'No rewind ID available' ),
	] )( 'identifies a missing backup', async ( error ) => {
		vi.mocked( fetchLatestRewindId ).mockRejectedValue( error );
		await expect( wpcomSites.pull!.latestBackupId( config, { id: 1 } ) ).rejects.toMatchObject( {
			code: 'missing_backup',
		} );
	} );

	it.each( [
		new Error( 'Network failure' ),
		Object.assign( new Error( 'Forbidden' ), { statusCode: 403, error: 'rest_forbidden' } ),
	] )( 'preserves other failures', async ( error ) => {
		vi.mocked( fetchLatestRewindId ).mockRejectedValue( error );
		await expect( wpcomSites.pull!.latestBackupId( config, { id: 1 } ) ).rejects.toMatchObject( {
			code: 'remote_backup',
		} );
	} );
} );

describe( 'push', () => {
	const archive = {
		kind: 'archive' as const,
		file: Readable.from( [ 'archive' ] ),
		name: 'push.tar.gz',
		size: 7,
	};
	const push = ( onStatus = vi.fn() ) =>
		wpcomSites.push( config, { id: 42, name: 'Live' }, archive, {}, onStatus );

	beforeEach( () => {
		vi.useFakeTimers();
		vi.mocked( createTusUpload ).mockImplementation( ( { onProgress } ) => {
			onProgress?.( 100 );
			return { promise: Promise.resolve( 'attachment-1' ), abort: vi.fn() };
		} );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'reports the upload, the remote backup and the import, until the import finishes', async () => {
		vi.mocked( pollImportStatus )
			.mockResolvedValueOnce( {
				success: true,
				status: 'initial_backup_started',
				backup_progress: 30,
			} as never )
			.mockResolvedValueOnce( {
				success: true,
				status: 'archive_import_started',
				import_progress: 50,
			} as never )
			.mockResolvedValueOnce( { success: true, status: 'finished' } as never );
		const onStatus = vi.fn();

		const pushed = push( onStatus );
		await vi.runAllTimersAsync();
		await pushed;

		expect( initiateImport ).toHaveBeenCalledWith( 'token', 42, 'attachment-1', {} );
		expect( onStatus.mock.calls.map( ( [ status ] ) => status ) ).toEqual( [
			{ phase: 'uploading', progress: 0 },
			{ phase: 'uploading', progress: 100 },
			{ phase: 'creatingRemoteBackup', progress: 0 },
			{ phase: 'creatingRemoteBackup', progress: 30 },
			{ phase: 'applyingChanges', progress: 50 },
		] );
	} );

	it.each( [
		{ intent: false, refusal: undefined },
		{ intent: true, refusal: undefined },
		{ intent: true, refusal: 'unauthorized' },
		{ intent: true, refusal: 'email_unverified' },
	] )(
		'launches only after importing with publish intent: $intent / $refusal',
		async ( { intent, refusal } ) => {
			const connection = { launchAfterPush: intent };
			vi.mocked( pollImportStatus ).mockResolvedValue( {
				success: true,
				status: 'finished',
			} as never );
			vi.mocked( launchSite ).mockImplementation( async () => {
				expect( pollImportStatus ).toHaveBeenCalled();
				if ( refusal ) {
					throw Object.assign( new Error( 'Forbidden' ), { statusCode: 403, error: refusal } );
				}
			} );
			const onStatus = vi.fn();
			const result = await wpcomSites.push(
				config,
				{ id: 42, name: 'Live' },
				archive,
				connection,
				onStatus
			);
			expect( launchSite ).toHaveBeenCalledTimes( intent ? 1 : 0 );
			if ( intent ) {
				expect( launchSite ).toHaveBeenCalledWith( 'token', 42 );
				expect( onStatus ).toHaveBeenLastCalledWith( { phase: 'launching' } );
			}
			if ( refusal ) {
				expect( result ).toMatchObject( {
					launchError: expect.stringContaining( 'Changes pushed' ),
				} );
				expect( connection.launchAfterPush ).toBe( true );
			} else {
				expect( result ).toBeUndefined();
			}
		}
	);

	it( 'follows an import whose progress stays flat for hours until the live site ends it', async () => {
		const finishAt = Date.now() + 5 * 60 * 60 * 1000;
		vi.mocked( pollImportStatus ).mockImplementation( async () =>
			Date.now() < finishAt
				? ( { success: true, status: 'archive_import_started', import_progress: 40 } as never )
				: ( { success: true, status: 'finished' } as never )
		);

		const pushed = push();
		await vi.advanceTimersByTimeAsync( 5 * 60 * 60 * 1000 + 3000 );
		await expect( pushed ).resolves.toBeUndefined();
	} );

	it( 'gives up when the live site never ends the import', async () => {
		vi.mocked( pollImportStatus ).mockResolvedValue( {
			success: true,
			status: 'archive_import_started',
			import_progress: 40,
		} as never );

		const pushed = push().catch( ( e: unknown ) => e );
		await vi.advanceTimersByTimeAsync( 7 * 60 * 60 * 1000 );
		expect( await pushed ).toMatchObject( { code: 'timeout' } );
	} );

	it( 'keeps waiting through a network failure while the live site imports', async () => {
		vi.mocked( pollImportStatus )
			.mockRejectedValueOnce(
				Object.assign( new Error( 'getaddrinfo ENOTFOUND public-api.wordpress.com' ), {
					code: 'ENOTFOUND',
				} )
			)
			.mockResolvedValueOnce( { success: true, status: 'finished' } as never );

		const pushed = push();
		await vi.runAllTimersAsync();
		await expect( pushed ).resolves.toBeUndefined();
	} );

	it( 'says the update may still be running when status checks keep failing', async () => {
		vi.mocked( pollImportStatus ).mockRejectedValue(
			Object.assign( new Error( 'socket hang up' ), { code: 'ECONNRESET' } )
		);

		const pushed = push().catch( ( e: unknown ) => e );
		await vi.advanceTimersByTimeAsync( 60 * 1000 );
		expect( await pushed ).toMatchObject( {
			message: expect.stringContaining( 'the update may still be running' ),
			code: 'remote_import',
		} );
	} );

	it.each( [
		Object.assign( new Error( 'Forbidden' ), { statusCode: 403 } ),
		new TypeError( "Cannot read properties of undefined (reading 'status')" ),
	] )( 'stops at once when the status check fails for good: %s', async ( error ) => {
		vi.mocked( pollImportStatus ).mockRejectedValue( error );

		await expect( push() ).rejects.toMatchObject( { code: 'remote_import' } );
		expect( pollImportStatus ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'explains a database the live site failed to import', async () => {
		vi.mocked( pollImportStatus ).mockResolvedValue( {
			success: false,
			status: 'failed',
			error: 'Import failed',
			error_data: { vp_restore_message: 'Error importing SQL dump' },
		} as never );

		await expect( push() ).rejects.toMatchObject( {
			message:
				'The database failed to import on the live site. Review your database and try again.',
			code: 'remote_import',
		} );
	} );

	it( "keeps the live site's failure reason in the cause", async () => {
		vi.mocked( pollImportStatus ).mockResolvedValue( {
			success: false,
			status: 'failed',
			error: 'Import failed',
			error_data: { vp_restore_message: "Error: 'wp-config.php' not found." },
		} as never );

		const error = await push().catch( ( e: unknown ) => e );

		expect( error ).toMatchObject( {
			message: 'Something went wrong while updating the live site.',
			cause: { message: "Error: 'wp-config.php' not found." },
		} );
	} );

	it( 'waits for an import already running on the site, then starts its own', async () => {
		vi.mocked( initiateImport )
			.mockRejectedValueOnce( Object.assign( new Error( 'Conflict' ), { statusCode: 409 } ) )
			.mockResolvedValueOnce( undefined );
		vi.mocked( pollImportStatus )
			.mockResolvedValueOnce( {
				success: true,
				status: 'archive_import_started',
				import_progress: 40,
			} as never )
			.mockResolvedValueOnce( {
				success: true,
				status: 'archive_import_started',
				import_progress: 90,
			} as never )
			.mockResolvedValue( { success: true, status: 'finished' } as never );
		const onStatus = vi.fn();

		const pushed = push( onStatus );
		await vi.runAllTimersAsync();
		await pushed;

		expect( createTusUpload ).toHaveBeenCalledTimes( 1 );
		expect( initiateImport ).toHaveBeenCalledTimes( 2 );
		expect( initiateImport ).toHaveBeenLastCalledWith( 'token', 42, 'attachment-1', {} );
		expect( onStatus.mock.calls.map( ( [ status ] ) => status ).slice( 2 ) ).toEqual( [
			{ phase: 'creatingRemoteBackup', progress: 0 },
			{ phase: 'waitingForRemote' },
			{ phase: 'creatingRemoteBackup', progress: 0 },
		] );
	} );

	it( 'says when the site is syncing with its staging site', async () => {
		vi.mocked( initiateImport ).mockRejectedValue(
			Object.assign( new Error( 'Conflict' ), { statusCode: 409 } )
		);
		vi.mocked( pollImportStatus ).mockResolvedValue( {
			success: true,
			status: 'finished',
		} as never );

		await expect( push() ).rejects.toMatchObject( {
			message: expect.stringContaining( 'staging site' ),
			code: 'remote_import',
		} );
		expect( initiateImport ).toHaveBeenCalledTimes( 1 );
	} );
} );
