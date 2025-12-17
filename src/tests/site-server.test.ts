/**
 * @jest-environment node
 */
import { CliServerProcess } from 'src/modules/cli/lib/cli-server-process';
import { SiteServer } from 'src/site-server';

// Electron's Node.js environment provides `bota`/`atob`, but Jests' does not
jest.mock( 'common/lib/passwords' );

// Mock the CLI server process
jest.mock( 'src/modules/cli/lib/cli-server-process' );

// Mock the WordPress setup
jest.mock( 'src/lib/wordpress-setup', () => ( {
	setupWordPressFilesOnly: jest.fn().mockResolvedValue( undefined ),
} ) );

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

			await expect( server.start() ).rejects.toThrow( 'Failed to start site' );
		} );

		it( 'should start the server successfully', async () => {
			const mockStart = jest.fn().mockResolvedValue( undefined );
			( CliServerProcess as jest.Mock ).mockReturnValue( {
				url: 'http://localhost:1234',
				start: mockStart,
				stop: jest.fn(),
			} );

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

			await server.start();

			expect( mockStart ).toHaveBeenCalled();
			expect( server.details.running ).toBe( true );
		} );
	} );
} );
