/**
 * @vitest-environment node
 */
import { vi, type Mock } from 'vitest';
import { SiteServer } from 'src/site-server';

// Electron's Node.js environment provides `bota`/`atob`, but Jests' does not
vi.mock( 'common/lib/passwords' );

// `SiteServer::start` uses `getPreferredSiteLanguage` to set the site language
vi.mock( 'src/lib/site-language', () => ( {
	getPreferredSiteLanguage: vi.fn().mockResolvedValue( 'en' ),
} ) );

<<<<<<< HEAD
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
=======
// Mock the WordPress setup
jest.mock( 'src/lib/wordpress-setup', () => ( {
	setupWordPressFilesOnly: jest.fn().mockResolvedValue( undefined ),
} ) );
>>>>>>> 3d31ad1e00b9363cc8c1fe93a3292145439494b5

// Mock the wp-now config that the provider uses internally
vi.mock( 'vendor/wp-now/src', () => ( {
	getWpNowConfig: vi.fn( () => ( { mode: 'wordpress', port: 1234 } ) ),
} ) );

describe( 'SiteServer', () => {
	describe( 'start', () => {
		it( 'should throw if the server starts with a non-WordPress mode', async () => {
			const { getWpNowConfig } = await import( 'vendor/wp-now/src' );
			( getWpNowConfig as Mock ).mockReturnValue( { mode: 'theme', port: 1234 } );

			const { startServer } = await import( 'src/lib/wordpress-provider' );
			( startServer as Mock ).mockRejectedValue(
				new Error(
					"Site server started with Playground's 'theme' mode. Studio only supports 'wordpress' mode."
				)
			);
			const server = SiteServer.create( {
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
