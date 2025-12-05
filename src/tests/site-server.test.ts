/**
 * @jest-environment node
 */
import { CliServerProcess } from 'src/modules/cli/lib/cli-server-process';
import { SiteServer } from 'src/site-server';

// Electron's Node.js environment provides `bota`/`atob`, but Jests' does not
jest.mock( 'common/lib/passwords' );

// Mock the CLI server process
jest.mock( 'src/modules/cli/lib/cli-server-process' );

// Mock the WordPress provider
jest.mock( 'src/lib/wordpress-provider', () => {
	const mockProvider = {
		DEFAULT_PHP_VERSION: '8.0',
		DEFAULT_WORDPRESS_VERSION: 'latest',
		ALLOWED_PHP_VERSIONS: [ '8.0', '8.1', '8.2', '8.3' ],
		SQLITE_FILENAME: 'sqlite-database-integration',
	};

	return {
		...mockProvider,
		getWordPressProvider: jest.fn( () => mockProvider ),
	};
} );

// Mock port finder
jest.mock( 'common/lib/port-finder', () => ( {
	portFinder: {
		isPortAvailable: jest.fn( () => Promise.resolve( true ) ),
	},
} ) );

// Mock user data
jest.mock( 'src/storage/user-data', () => ( {
	loadUserData: jest.fn( () => Promise.resolve( { sites: [] } ) ),
} ) );

describe( 'SiteServer', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	describe( 'start', () => {
		it( 'should throw if the CLI server fails to start', async () => {
			const mockStart = jest.fn().mockRejectedValue( new Error( 'Failed to start site' ) );
			( CliServerProcess as jest.Mock ).mockReturnValue( {
				url: 'http://localhost:1234',
				start: mockStart,
				stop: jest.fn(),
			} );

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

			await expect( server.start() ).rejects.toThrow( 'Failed to start site' );
		} );

		it( 'should start the server successfully', async () => {
			const mockStart = jest.fn().mockResolvedValue( undefined );
			( CliServerProcess as jest.Mock ).mockReturnValue( {
				url: 'http://localhost:1234',
				start: mockStart,
				stop: jest.fn(),
			} );

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

			await server.start();

			expect( mockStart ).toHaveBeenCalled();
			expect( server.details.running ).toBe( true );
		} );
	} );
} );
