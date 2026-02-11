/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import { SiteServer } from 'src/site-server';

// Electron's Node.js environment provides `btoa`/`atob`, but Vitest's does not
vi.mock( '@studio/common/lib/passwords' );

// `SiteServer::start` uses `getPreferredSiteLanguage` to set the site language
vi.mock( 'src/lib/site-language', () => ( {
	getPreferredSiteLanguage: vi.fn().mockResolvedValue( 'en' ),
} ) );

// Mock the WordPress setup
vi.mock( 'src/lib/wordpress-setup', () => ( {
	setupWordPressFilesOnly: vi.fn().mockResolvedValue( undefined ),
} ) );

// Mock the WordPress provider
vi.mock( 'src/lib/wordpress-provider', () => {
	const mockProvider = {
		DEFAULT_PHP_VERSION: '8.0',
		DEFAULT_WORDPRESS_VERSION: 'latest',
		ALLOWED_PHP_VERSIONS: [ '8.0', '8.1', '8.2', '8.3' ],
		SQLITE_FILENAME: 'sqlite-database-integration',
		getWordPressVersionPath: vi.fn( ( version ) => `/mock/path/to/wp-${ version }` ),
		getSqlitePath: vi.fn( () => '/mock/path/to/sqlite' ),
		getWpCliPath: vi.fn( () => '/mock/path/to/wp-cli' ),
		getWpCliFolderPath: vi.fn( () => '/mock/path/to/wp-cli-folder' ),
		downloadWordPress: vi.fn(),
		downloadWpCli: vi.fn(),
		downloadSQLiteCommand: vi.fn(),
		setupWordPressSite: vi.fn( () => Promise.resolve( true ) ),
		startServer: vi.fn( () =>
			Promise.resolve( {
				url: 'http://localhost:1234',
				options: { port: 1234, phpVersion: '8.0' },
				_internal: { mode: 'wordpress', port: 1234 },
			} )
		),
		createServerProcess: vi.fn( () => ( {
			url: 'http://localhost:1234',
			php: {},
			start: vi.fn( () => Promise.resolve() ),
			stop: vi.fn( () => Promise.resolve() ),
			runPhp: vi.fn( () => Promise.resolve( '' ) ),
		} ) ),
		executeWPCli: vi.fn(),
		isValidWordPressVersion: vi.fn( () => true ),
		getConfig: vi.fn( () => Promise.resolve( {} ) ),
	};

	return {
		...mockProvider,
		getWordPressProvider: vi.fn( () => mockProvider ),
	};
} );

// Mock the wp-now config that the provider uses internally

vi.mock( 'vendor/wp-now/src', () => ( {
	getWpNowConfig: vi.fn( () => ( { mode: 'wordpress', port: 1234 } ) ),
} ) );

// Mock CliServerProcess with a start method that calls startServer
vi.mock( 'src/modules/cli/lib/cli-server-process', () => ( {
	CliServerProcess: vi.fn().mockImplementation( () => ( {
		url: 'http://localhost:1234',
		start: vi.fn( async () => {
			// eslint-disable-next-line import/no-unresolved
			const { startServer } = await import( 'src/lib/wordpress-provider' );
			return startServer();
		} ),
		stop: vi.fn(),
		delete: vi.fn(),
	} ) ),
} ) );

vi.mock( 'src/storage/user-data' );

describe( 'SiteServer', () => {
	describe( 'start', () => {
		it( 'should throw if the server starts with a non-WordPress mode', async () => {
			// eslint-disable-next-line import/no-unresolved
			const { getWpNowConfig } = await import( 'vendor/wp-now/src' );
			vi.mocked( getWpNowConfig ).mockReturnValue( { mode: 'theme', port: 1234 } );

			// eslint-disable-next-line import/no-unresolved
			const { startServer } = await import( 'src/lib/wordpress-provider' );
			vi.mocked( startServer ).mockRejectedValue(
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
				phpVersion: '8.3',
				running: false,
				themeDetails: undefined,
			} );

			await expect( server.start() ).rejects.toThrow(
				"Site server started with Playground's 'theme' mode. Studio only supports 'wordpress' mode."
			);
		} );
	} );
} );
