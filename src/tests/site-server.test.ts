/**
 * @jest-environment node
 */
import { SiteServer } from 'src/site-server';

// Electron's Node.js environment provides `bota`/`atob`, but Jests' does not
jest.mock( 'src/lib/passwords' );

// `SiteServer::start` uses `getPreferredSiteLanguage` to set the site language
jest.mock( 'src/lib/site-language', () => ( {
	getPreferredSiteLanguage: jest.fn().mockResolvedValue( 'en' ),
} ) );

// Mock the WordPress provider
jest.mock( 'src/lib/wordpress-provider', () => {
	const mockProvider = {
		DEFAULT_PHP_VERSION: '8.0',
		DEFAULT_WORDPRESS_VERSION: 'latest',
		ALLOWED_PHP_VERSIONS: [ '8.0', '8.1', '8.2', '8.3' ],
		SQLITE_FILENAME: 'sqlite-database-integration',
		getWordPressVersionPath: jest.fn( ( version ) => `/mock/path/to/wp-${ version }` ),
		getSqlitePath: jest.fn( () => '/mock/path/to/sqlite' ),
		getWpCliPath: jest.fn( () => '/mock/path/to/wp-cli' ),
		getWpCliFolderPath: jest.fn( () => '/mock/path/to/wp-cli-folder' ),
		downloadWordPress: jest.fn(),
		downloadWpCli: jest.fn(),
		downloadSQLiteCommand: jest.fn(),
		setupWordPressSite: jest.fn( () => Promise.resolve( true ) ),
		startServer: jest.fn( () =>
			Promise.resolve( {
				url: 'http://localhost:1234',
				options: { port: 1234, phpVersion: '8.0' },
				_internal: { mode: 'wordpress', port: 1234 },
			} )
		),
		createServerProcess: jest.fn( () => ( {
			url: 'http://localhost:1234',
			php: {},
			start: jest.fn( () => Promise.resolve() ),
			stop: jest.fn( () => Promise.resolve() ),
			runPhp: jest.fn( () => Promise.resolve( '' ) ),
		} ) ),
		executeWPCli: jest.fn(),
		isValidWordPressVersion: jest.fn( () => true ),
		getConfig: jest.fn( () => Promise.resolve( {} ) ),
	};

	return {
		...mockProvider,
		getWordPressProvider: jest.fn( () => mockProvider ),
	};
} );

// Mock the wp-now config that the provider uses internally
jest.mock( 'vendor/wp-now/src', () => ( {
	getWpNowConfig: jest.fn( () => ( { mode: 'wordpress', port: 1234 } ) ),
} ) );

describe( 'SiteServer', () => {
	describe( 'start', () => {
		it( 'should throw if the server starts with a non-WordPress mode', async () => {
			const { getWpNowConfig } = require( 'vendor/wp-now/src' );
			( getWpNowConfig as jest.Mock ).mockReturnValue( { mode: 'theme', port: 1234 } );

			const { startServer } = require( 'src/lib/wordpress-provider' );
			( startServer as jest.Mock ).mockRejectedValue(
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
