import { readAppdata } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';

jest.mock( 'cli/lib/appdata', () => ( {
	...jest.requireActual( 'cli/lib/appdata' ),
	readAppdata: jest.fn(),
	getAppdataDirectory: jest.fn().mockReturnValue( '/test/appdata' ),
} ) );
jest.mock( 'cli/lib/pm2-manager' );
jest.mock( 'cli/lib/wordpress-server-manager' );

describe( 'CLI: studio site list', () => {
	// Simple test data
	const testAppdata = {
		sites: [
			{
				id: 'site-1',
				name: 'Test Site 1',
				path: '/path/to/site1',
				port: 8080,
			},
			{
				id: 'site-2',
				name: 'Test Site 2',
				path: '/path/to/site2',
				port: 8081,
				customDomain: 'my-site.wp.local',
			},
		],
		snapshots: [],
	};

	const emptyAppdata = {
		sites: [],
		snapshots: [],
	};

	beforeEach( () => {
		jest.clearAllMocks();

		( readAppdata as jest.Mock ).mockResolvedValue( testAppdata );
		( connect as jest.Mock ).mockResolvedValue( undefined );
		( disconnect as jest.Mock ).mockResolvedValue( undefined );
		( isServerRunning as jest.Mock ).mockResolvedValue( false );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when appdata read fails', async () => {
			( readAppdata as jest.Mock ).mockRejectedValue( new Error( 'Failed to read appdata' ) );

			const { runCommand } = await import( '../list' );

			await expect( runCommand( 'table', false ) ).rejects.toThrow( 'Failed to read appdata' );
			expect( disconnect ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should list sites with table format', async () => {
			const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();
			const { runCommand } = await import( '../list' );

			await runCommand( 'table', false );

			expect( readAppdata ).toHaveBeenCalled();
			expect( consoleSpy ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();

			consoleSpy.mockRestore();
		} );

		it( 'should list sites with json format', async () => {
			const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();
			const { runCommand } = await import( '../list' );

			await runCommand( 'json', false );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					[
						{
							id: 'site-1',
							status: '🔴 Offline',
							name: 'Test Site 1',
							path: '/path/to/site1',
							url: 'http://localhost:8080',
						},
						{
							id: 'site-2',
							status: '🔴 Offline',
							name: 'Test Site 2',
							path: '/path/to/site2',
							url: 'http://my-site.wp.local',
						},
					],
					null,
					2
				)
			);
			expect( disconnect ).toHaveBeenCalled();

			consoleSpy.mockRestore();
		} );

		it( 'should handle no sites found', async () => {
			( readAppdata as jest.Mock ).mockResolvedValue( emptyAppdata );

			const { runCommand } = await import( '../list' );

			await runCommand( 'table', false );

			expect( readAppdata ).toHaveBeenCalled();
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should handle custom domain in site URL', async () => {
			const consoleSpy = jest.spyOn( console, 'log' ).mockImplementation();
			const { runCommand } = await import( '../list' );

			await runCommand( 'json', false );

			expect( consoleSpy ).toHaveBeenCalledWith( expect.stringContaining( 'my-site.wp.local' ) );
			expect( disconnect ).toHaveBeenCalled();

			consoleSpy.mockRestore();
		} );
	} );
} );
