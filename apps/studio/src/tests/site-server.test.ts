/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import { createSiteViaCli } from 'src/modules/cli/lib/cli-site-creator';
import { SiteServer } from 'src/site-server';

// Electron's Node.js environment provides `btoa`/`atob`, but Vitest's does not
vi.mock( '@studio/common/lib/passwords' );

vi.mock( 'src/modules/cli/lib/cli-site-creator', () => ( {
	createSiteViaCli: vi.fn(),
} ) );

// Mock the WordPress provider
const mockStartServer = vi.fn().mockResolvedValue( {
	url: 'http://localhost:1234',
	options: { port: 1234, phpVersion: '8.0' },
	_internal: { mode: 'wordpress', port: 1234 },
} );

vi.mock( 'src/lib/wordpress-provider', () => {
	const mockProvider = {
		DEFAULT_PHP_VERSION: '8.0',
		DEFAULT_WORDPRESS_VERSION: 'latest',
		ALLOWED_PHP_VERSIONS: [ '8.0', '8.1', '8.2', '8.3', '8.4' ],
		SQLITE_FILENAME: 'sqlite-database-integration',
		getWordPressVersionPath: vi
			.fn()
			.mockImplementation( ( version ) => `/mock/path/to/wp-${ version }` ),
		getSqlitePath: vi.fn().mockReturnValue( '/mock/path/to/sqlite' ),
		getWpCliPath: vi.fn().mockReturnValue( '/mock/path/to/wp-cli' ),
		getWpCliFolderPath: vi.fn().mockReturnValue( '/mock/path/to/wp-cli-folder' ),
		downloadWordPress: vi.fn(),
		downloadWpCli: vi.fn(),
		downloadSQLiteCommand: vi.fn(),
		setupWordPressSite: vi.fn().mockResolvedValue( true ),
		startServer: mockStartServer,
		createServerProcess: vi.fn().mockReturnValue( {
			url: 'http://localhost:1234',
			php: {},
			start: vi.fn().mockResolvedValue( undefined ),
			stop: vi.fn().mockResolvedValue( undefined ),
			runPhp: vi.fn().mockResolvedValue( '' ),
		} ),
		executeWPCli: vi.fn(),
		isValidWordPressVersion: vi.fn().mockReturnValue( true ),
		getConfig: vi.fn().mockResolvedValue( {} ),
	};

	return {
		...mockProvider,
		getWordPressProvider: vi.fn().mockReturnValue( mockProvider ),
	};
} );

// Mock CliServerProcess with a start method that calls startServer
vi.mock( 'src/modules/cli/lib/cli-server-process', () => {
	class MockCliServerProcess {
		url = 'http://localhost:1234';
		start = vi.fn().mockImplementation( async () => {
			return mockStartServer();
		} );
		stop = vi.fn();
		delete = vi.fn();
	}

	return {
		CliServerProcess: MockCliServerProcess,
	};
} );

vi.mock( 'src/storage/user-data' );

vi.mock( 'src/lib/beta-features', () => ( {
	getDefaultSiteRuntime: vi.fn().mockResolvedValue( 'playground' ),
} ) );

describe( 'SiteServer', () => {
	describe( 'create', () => {
		beforeEach( () => {
			vi.mocked( createSiteViaCli ).mockReset();
		} );

		it( 'sets details.port from the CLI result instead of the placeholder 0', async () => {
			vi.mocked( createSiteViaCli ).mockResolvedValue( {
				id: 'create-port-1',
				port: 8765,
				running: false,
			} );

			const { server, details } = await SiteServer.create( {
				siteId: 'create-port-1',
				path: '/tmp/create-port-1',
				name: 'create-port-1',
			} );

			expect( details.port ).toBe( 8765 );
			expect( server.details.port ).toBe( 8765 );
			expect( details.running ).toBe( false );
		} );

		it( 'transitions to StartedSiteDetails with a localhost URL when CLI reports running', async () => {
			vi.mocked( createSiteViaCli ).mockResolvedValue( {
				id: 'create-port-2',
				port: 9100,
				running: true,
			} );

			const { server, details } = await SiteServer.create( {
				siteId: 'create-port-2',
				path: '/tmp/create-port-2',
				name: 'create-port-2',
			} );

			expect( details.running ).toBe( true );
			expect( details.port ).toBe( 9100 );
			if ( details.running ) {
				expect( details.url ).toBe( 'http://localhost:9100' );
			}
			expect( server.server.url ).toBe( 'http://localhost:9100' );
		} );

		it( 'never returns a placeholder port 0 once the CLI has assigned a real port', async () => {
			vi.mocked( createSiteViaCli ).mockResolvedValue( {
				id: 'create-port-3',
				port: 8881,
				running: true,
			} );

			const { details } = await SiteServer.create( {
				siteId: 'create-port-3',
				path: '/tmp/create-port-3',
				name: 'create-port-3',
			} );

			expect( details.port ).not.toBe( 0 );
		} );

		// A leftover placeholder is a site the CLI does not know: unstartable, undeletable, and its
		// path stays taken.
		it( 'drops the placeholder when the CLI fails, leaving no site behind', async () => {
			vi.mocked( createSiteViaCli ).mockRejectedValue( new Error( 'Failed to apply Blueprint' ) );

			await expect(
				SiteServer.create( {
					siteId: 'create-failure-1',
					path: '/tmp/create-failure-1',
					name: 'create-failure-1',
				} )
			).rejects.toThrow( 'Failed to apply Blueprint' );

			expect( SiteServer.get( 'create-failure-1' ) ).toBeUndefined();
			expect( SiteServer.getAllDetails().map( ( { path } ) => path ) ).not.toContain(
				'/tmp/create-failure-1'
			);
		} );

		// `isDeleted` gates WP-CLI calls, so marking it would be wrong if the id were reused.
		it( 'does not mark the failed site as deleted', async () => {
			vi.mocked( createSiteViaCli ).mockRejectedValue( new Error( 'Failed to create site' ) );

			await expect(
				SiteServer.create( {
					siteId: 'create-failure-2',
					path: '/tmp/create-failure-2',
					name: 'create-failure-2',
				} )
			).rejects.toThrow();

			expect( SiteServer.isDeleted( 'create-failure-2' ) ).toBe( false );
		} );
	} );

	describe( 'start', () => {
		it( 'should throw if the server starts with a non-WordPress mode', async () => {
			mockStartServer.mockRejectedValue(
				new Error(
					"Site server started with Playground's 'theme' mode. Studio only supports 'wordpress' mode."
				)
			);

			const server = SiteServer.register( {
				id: 'test-id',
				name: 'test-name',
				path: 'test-path',
				port: 1234,
				adminPassword: 'test-password',
				phpVersion: '8.4',
				running: false,
				themeDetails: undefined,
			} );

			await expect( server.start() ).rejects.toThrow(
				"Site server started with Playground's 'theme' mode. Studio only supports 'wordpress' mode."
			);
		} );
	} );
} );
