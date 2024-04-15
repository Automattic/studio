/**
 * @jest-environment node
 */
import { getWpNowConfig } from '../../vendor/wp-now/src';
import { SiteServer } from '../site-server';

// Electron's Node.js environment provides `bota`/`atob`, but Jests' does not
jest.mock( '../lib/passwords' );

// `download` and `config` are private APIs that must be mocked individually
jest.mock( '../../vendor/wp-now/src/download' );
jest.mock( '../../vendor/wp-now/src/config' );

jest.mock( '../../vendor/wp-now/src', () => ( {
	getWpNowConfig: jest.fn( () => ( { mode: 'wordpress', port: 1234 } ) ),
	startServer: jest.fn( () =>
		Promise.resolve( {
			options: { port: 1234 },
			php: {},
		} )
	),
} ) );

jest.mock( 'electron', () => ( {
	app: {
		getPreferredSystemLanguages: jest.fn( () => [ 'en-US' ] ),
		getPath: jest.fn( () => '/path/to/app' ),
	},
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
				running: false,
				themeDetails: undefined,
			} );

			await expect( server.start() ).rejects.toThrow(
				"Site server started with Playground's 'theme' mode. Studio only supports 'wordpress' mode."
			);
		} );
	} );
} );
