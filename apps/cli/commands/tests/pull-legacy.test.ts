import { readAuthToken } from '@studio/common/lib/shared-config';
import { SYNC_PUSH_SIZE_LIMIT_BYTES } from '@studio/common/lib/sync/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getImporter } from 'cli/lib/import-export/import/import-manager';
import { withSiteOperation } from 'cli/lib/site-operations';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { backupRemoteSite, fetchSyncableSites } from 'cli/lib/sync-api';
import { fetchPullTree, selectSyncItemsForPull } from 'cli/lib/sync-selector';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger } from 'cli/logger';
import { runCommand } from '../pull-legacy';
import type { SyncSite } from '@studio/common/types/sync';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( '@studio/common/lib/shared-config', async ( importActual ) => ( {
	...( await importActual< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/remote-sites' );
vi.mock( 'cli/lib/cli-config/sites', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/cli-config/sites') >() ),
	getSiteByFolder: vi.fn(),
	clearSiteLatestCliPid: vi.fn(),
} ) );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/import-export/import/import-manager', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/import-export/import/import-manager') >() ),
	getImporter: vi.fn(),
} ) );
vi.mock( 'cli/lib/site-operations' );
vi.mock( 'cli/lib/sync-activity' );
vi.mock( 'cli/lib/tracks' );
vi.mock( 'cli/lib/sync-selector' );
vi.mock( 'cli/lib/sync-api', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/sync-api') >() ),
	fetchSyncableSites: vi.fn(),
	backupRemoteSite: vi.fn(),
	downloadBackup: vi.fn(),
} ) );
vi.mock( 'cli/lib/wordpress-server-manager' );

const site = { id: 'site-1', path: '/test/site', port: 8080 } as SiteData;
const remoteSite = { id: 42, syncSupport: 'syncable' } as SyncSite;

describe( 'CLI: studio pull', () => {
	const steps: string[] = [];
	const importBackup = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		steps.length = 0;
		vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'token' } as never );
		vi.mocked( getSiteByFolder ).mockResolvedValue( site );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ remoteSite ] );
		vi.mocked( backupRemoteSite ).mockResolvedValue( {
			url: 'https://example.com/backup.tar.gz',
			size: 1,
		} );
		vi.mocked( isServerRunning ).mockResolvedValue( {} as never );
		vi.mocked( stopWordPressServer ).mockImplementation( async () => void steps.push( 'stop' ) );
		vi.mocked( startWordPressServer ).mockImplementation( async () => {
			steps.push( 'start' );
			return {} as never;
		} );
		importBackup.mockImplementation( async () => void steps.push( 'import' ) );
		vi.mocked( getImporter ).mockReturnValue( { on: vi.fn(), import: importBackup } as never );
		vi.mocked( withSiteOperation ).mockImplementation( async ( _folder, kind, fn ) => {
			steps.push( `hold ${ kind }` );
			try {
				return await fn();
			} finally {
				steps.push( 'release' );
			}
		} );
	} );

	it.each( [
		[ 'succeeds', [ 'hold import', 'stop', 'import', 'start', 'release' ], 'success' ],
		[ 'fails', [ 'hold import', 'stop', 'start', 'release' ], 'error' ],
	] )(
		'holds the site until it has restarted when the import %s',
		async ( outcome, expected, result ) => {
			if ( outcome === 'fails' ) {
				importBackup.mockRejectedValue( new Error( 'boom' ) );
			}

			await runCommand( site.path, [ 'all' ], String( remoteSite.id ) ).catch( () => undefined );

			expect( steps ).toEqual( expected );
			expect( vi.mocked( reportSyncActivity ).mock.calls.at( -1 ) ).toEqual( [
				site.id,
				expect.objectContaining( { kind: result, direction: 'pull' } ),
			] );
		}
	);

	it( 'reports the remote environment in a completed backup pull', async () => {
		const destination = {
			...remoteSite,
			name: 'Live',
			url: 'https://example.wpcomstaging.com',
			isStaging: false,
			environmentType: 'production',
		};
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ destination ] );
		const messages: string[] = [];
		const logger = new Logger< never >( { onProgress: ( message ) => messages.push( message ) } );
		await runCommand( site.path, [ 'all' ], String( destination.id ), undefined, logger );
		expect( messages[ messages.length - 1 ] ).toContain( destination.url );
		expect( messages[ messages.length - 1 ] ).toContain(
			'Remote environment: {"isStaging":false,"environmentType":"production"}'
		);
	} );

	it.each( [ false, true ] )( 'classifies real paths (interactive: %s)', async ( interactive ) => {
		vi.mocked( fetchPullTree ).mockResolvedValueOnce( { tree: [], rewindId: 'rewind' } );
		vi.mocked( selectSyncItemsForPull ).mockResolvedValueOnce( {
			optionsToSync: [ 'paths' ],
			includePathList: [ 'opaque-id' ],
			specificSelectionPaths: [ 'plugins' ],
		} );

		await runCommand(
			site.path,
			interactive ? undefined : [ 'paths' ],
			String( remoteSite.id ),
			interactive ? undefined : [ 'opaque-id' ],
			undefined,
			undefined,
			interactive ? undefined : [ 'plugins' ]
		);

		expect( backupRemoteSite ).toHaveBeenCalledWith(
			'token',
			remoteSite.id,
			{ optionsToSync: [ 'paths' ], includePathList: [ 'opaque-id' ] },
			expect.any( Function )
		);
		expect( recordTracksEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SYNC_PULL,
			expect.objectContaining( { selection: 'categories', includes_database: false } )
		);
	} );

	it.each( [
		[ 'warns and continues without asking when nobody can answer', undefined, true ],
		[ 'stops when the user declines', async () => false, false ],
	] )( 'pulling a backup over the size limit %s', async ( _case, confirm, imported ) => {
		vi.mocked( backupRemoteSite ).mockResolvedValue( {
			url: 'https://example.com/backup.tar.gz',
			size: SYNC_PUSH_SIZE_LIMIT_BYTES + 1,
		} );
		const messages: string[] = [];
		const logger = new Logger< never >( { onProgress: ( message ) => messages.push( message ) } );

		await runCommand( site.path, [ 'all' ], String( remoteSite.id ), undefined, logger, confirm );

		expect( steps.includes( 'import' ) ).toBe( imported );
		expect( messages.some( ( message ) => message.includes( 'exceeds' ) ) ).toBe( ! confirm );
	} );

	it.each( [
		[ 'only restarting the site fails', 'start', true ],
		[ 'the import fails', 'import', false ],
	] )(
		'reports whether the pull reached the site when %s',
		async ( _case, failingStep, localChangesApplied ) => {
			const failure = failingStep === 'start' ? vi.mocked( startWordPressServer ) : importBackup;
			failure.mockRejectedValueOnce( new Error( 'boom' ) );

			await expect( runCommand( site.path, [ 'all' ], String( remoteSite.id ) ) ).rejects.toThrow();

			expect( vi.mocked( reportSyncActivity ).mock.calls.at( -1 ) ).toEqual( [
				site.id,
				expect.objectContaining( { kind: 'error', direction: 'pull', localChangesApplied } ),
			] );
		}
	);
} );
