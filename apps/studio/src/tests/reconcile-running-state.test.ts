/**
 * @vitest-environment node
 */
import EventEmitter from 'node:events';
import { listSites } from '@studio/common/sites/list';
import { vi } from 'vitest';
import { SiteServer, reconcileSitesRunningState } from 'src/site-server';

// `vi.mock` calls are hoisted above the imports above, so SiteServer sees the mocked CLI plumbing.
vi.mock( 'src/modules/cli/lib/execute-command', () => ( {
	executeCliCommand: vi.fn().mockReturnValue( [ new EventEmitter(), { kill: vi.fn() } ] ),
	getTracksOriginEnv: vi.fn( () => 'studio-ui:v1' ),
} ) );
vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
	setTag: vi.fn(),
} ) );
vi.mock( '@studio/common/sites/list', () => ( {
	listSites: vi.fn(),
} ) );

const mockListSites = vi.mocked( listSites );

function cliItem( id: string, running: boolean ) {
	return {
		id,
		name: id,
		path: `/sites/${ id }`,
		port: 8881,
		phpVersion: '8.3',
		url: 'http://localhost:8881',
		running,
	};
}

describe( 'reconcileSitesRunningState', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'marks a site stopped when the CLI reports it is no longer running', async () => {
		SiteServer.register( {
			id: 'stopped-in-reality',
			name: 'stopped-in-reality',
			path: '/sites/stopped-in-reality',
			port: 8881,
			phpVersion: '8.3',
			running: true,
			url: 'http://localhost:8881',
		} );
		mockListSites.mockResolvedValue( [ cliItem( 'stopped-in-reality', false ) ] );

		await reconcileSitesRunningState();

		expect( SiteServer.get( 'stopped-in-reality' )?.details.running ).toBe( false );
	} );

	it( 'marks a site running (with url) when the CLI reports it is actually running', async () => {
		SiteServer.register( {
			id: 'running-in-reality',
			name: 'running-in-reality',
			path: '/sites/running-in-reality',
			port: 8882,
			phpVersion: '8.3',
			running: false,
		} );
		mockListSites.mockResolvedValue( [ cliItem( 'running-in-reality', true ) ] );

		await reconcileSitesRunningState();

		const details = SiteServer.get( 'running-in-reality' )?.details;
		expect( details?.running ).toBe( true );
		expect( details?.running && details.url ).toBe( 'http://localhost:8882' );
	} );

	it( 'leaves a site untouched when the CLI does not report it (e.g. mid-creation)', async () => {
		SiteServer.register( {
			id: 'not-in-cli-list',
			name: 'not-in-cli-list',
			path: '/sites/not-in-cli-list',
			port: 8883,
			phpVersion: '8.3',
			running: true,
			url: 'http://localhost:8883',
		} );
		mockListSites.mockResolvedValue( [ cliItem( 'some-other-site', false ) ] );

		await reconcileSitesRunningState();

		expect( SiteServer.get( 'not-in-cli-list' )?.details.running ).toBe( true );
	} );

	it( 'does not throw and leaves state unchanged when listing sites fails', async () => {
		SiteServer.register( {
			id: 'list-failed',
			name: 'list-failed',
			path: '/sites/list-failed',
			port: 8884,
			phpVersion: '8.3',
			running: true,
			url: 'http://localhost:8884',
		} );
		mockListSites.mockRejectedValue( new Error( 'daemon unreachable' ) );

		await expect( reconcileSitesRunningState() ).resolves.toBeUndefined();
		expect( SiteServer.get( 'list-failed' )?.details.running ).toBe( true );
	} );

	it( 'keeps a site running while it serves a PHP-error page, even though the CLI reports it stopped', async () => {
		SiteServer.register( {
			id: 'in-recovery',
			name: 'in-recovery',
			path: '/sites/in-recovery',
			port: 8885,
			phpVersion: '8.3',
			running: true,
			url: 'http://localhost:8885',
		} );
		const server = SiteServer.get( 'in-recovery' );
		if ( server ) {
			server.inErrorRecovery = true;
		}
		mockListSites.mockResolvedValue( [ cliItem( 'in-recovery', false ) ] );

		await reconcileSitesRunningState();

		expect( SiteServer.get( 'in-recovery' )?.details.running ).toBe( true );
	} );
} );
