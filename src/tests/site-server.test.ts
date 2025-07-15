/**
 * @jest-environment node
 */
import { SiteServer } from 'src/site-server';
import { getWpNowConfig } from 'vendor/wp-now/src';

// Electron's Node.js environment provides `bota`/`atob`, but Jests' does not
jest.mock( 'src/lib/passwords' );

// `SiteServer::start` uses `getPreferredSiteLanguage` to set the site language
jest.mock( 'src/lib/site-language', () => ( {
	getPreferredSiteLanguage: jest.fn().mockResolvedValue( 'en' ),
} ) );

// `download` and `config` are private APIs that must be mocked individually
jest.mock( 'vendor/wp-now/src/download', () => ( {
	getWordPressVersionPath: jest.fn( ( version ) => `/mock/path/to/wp-${ version }` ),
	downloadWordPress: jest.fn(),
	downloadWpCli: jest.fn(),
	downloadSQLiteCommand: jest.fn(),
} ) );
jest.mock( 'vendor/wp-now/src/config' );
jest.mock( 'vendor/wp-now/src/get-sqlite-path', () => ( {
	default: jest.fn( () => '/mock/path/to/sqlite' ),
} ) );
jest.mock( 'vendor/wp-now/src/get-wp-cli-path', () => ( {
	default: jest.fn( () => '/mock/path/to/wp-cli' ),
	getWpCliFolderPath: jest.fn( () => '/mock/path/to/wp-cli-folder' ),
} ) );

jest.mock( 'vendor/wp-now/src', () => ( {
	getWpNowConfig: jest.fn( () => ( { mode: 'wordpress', port: 1234 } ) ),
	startServer: jest.fn( () =>
		Promise.resolve( {
			options: { port: 1234 },
			php: {},
		} )
	),
} ) );

describe( 'SiteServer', () => {
	describe( 'start', () => {
		it( 'should throw if the server starts with a non-WordPress mode', async () => {
			( getWpNowConfig as jest.Mock ).mockReturnValue( { mode: 'theme', port: 1234 } );
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
