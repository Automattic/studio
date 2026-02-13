/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import { SiteServer } from 'src/site-server';

// Electron's Node.js environment provides `btoa`/`atob`, but Vitest's does not
vi.mock( 'common/lib/passwords' );

// `SiteServer::start` uses `getPreferredSiteLanguage` to set the site language
vi.mock( 'src/lib/site-language', () => ( {
	getPreferredSiteLanguage: vi.fn().mockResolvedValue( 'en' ),
} ) );

// Mock the WordPress setup
vi.mock( 'src/lib/wordpress-setup', () => ( {
	setupWordPressFilesOnly: vi.fn().mockResolvedValue( undefined ),
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
		ALLOWED_PHP_VERSIONS: [ '8.0', '8.1', '8.2', '8.3' ],
		SQLITE_FILENAME: 'sqlite-database-integration',
		getWordPressVersionPath: vi.fn().mockImplementation( ( version ) => `/mock/path/to/wp-${ version }` ),
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

// Mock the wp-now config that the provider uses internally
const mockGetWpNowConfig = vi.fn().mockReturnValue( { mode: 'wordpress', port: 1234 } );
vi.mock( 'vendor/wp-now/src', () => ( {
	getWpNowConfig: mockGetWpNowConfig,
} ) );

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

describe( 'SiteServer', () => {
	describe( 'start', () => {
		it( 'should throw if the server starts with a non-WordPress mode', async () => {
			mockGetWpNowConfig.mockReturnValue( { mode: 'theme', port: 1234 } );

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
