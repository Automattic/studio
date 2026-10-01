import { readAuthToken } from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getImporter } from 'cli/lib/import-export/import/import-manager';
import { withSiteOperation } from 'cli/lib/site-operations';
import { checkBackupSize, fetchSyncableSites, pollBackupStatus } from 'cli/lib/sync-api';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../pull';
import type { SyncSite } from '@studio/common/types/sync';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( '@studio/common/lib/shared-config', async ( importActual ) => ( {
	...( await importActual< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/connected-sites' );
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
vi.mock( 'cli/lib/sync-api', async ( importActual ) => ( {
	...( await importActual< typeof import('cli/lib/sync-api') >() ),
	fetchSyncableSites: vi.fn(),
	initiateBackup: vi.fn(),
	pollBackupStatus: vi.fn(),
	checkBackupSize: vi.fn(),
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
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( undefined ) );
		vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'token' } as never );
		vi.mocked( getSiteByFolder ).mockResolvedValue( site );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ remoteSite ] );
		vi.mocked( pollBackupStatus ).mockResolvedValue( {
			status: 'finished',
			downloadUrl: 'https://example.com/backup.tar.gz',
		} as never );
		vi.mocked( checkBackupSize ).mockResolvedValue( 1 );
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
		[ 'succeeds', [ 'hold import', 'stop', 'import', 'start', 'release' ] ],
		[ 'fails', [ 'hold import', 'stop', 'start', 'release' ] ],
	] )( 'holds the site until it has restarted when the import %s', async ( outcome, expected ) => {
		if ( outcome === 'fails' ) {
			importBackup.mockRejectedValue( new Error( 'boom' ) );
		}

		await runCommand(
			site.path,
			[ 'all' ],
			String( remoteSite.id ),
			undefined,
			undefined,
			true
		).catch( () => undefined );

		expect( steps ).toEqual( expected );
	} );
} );
