import { vi } from 'vitest';
import { readAppdata } from 'cli/lib/appdata';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../list';
vi.mock( 'cli/lib/appdata', async () => {
	const actual = await vi.importActual( 'cli/lib/appdata' );
	return {
		...actual,
		readAppdata: vi.fn(),
		getAppdataDirectory: vi.fn().mockReturnValue( '/test/appdata' ),
	};
} );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/wordpress-server-manager' );

describe( 'CLI: studio site list', () => {
	// Simple test data
	const testAppdata = {
		sites: [
			{
				id: 'site-1',
				name: 'Test Site 1',
				path: '/path/to/site1',
				port: 8080,
				phpVersion: '8.0',
			},
			{
				id: 'site-2',
				name: 'Test Site 2',
				path: '/path/to/site2',
				port: 8081,
				phpVersion: '8.0',
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
		vi.clearAllMocks();

		vi.mocked( readAppdata ).mockResolvedValue( testAppdata );
		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when appdata read fails', async () => {
			vi.mocked( readAppdata ).mockRejectedValue( new Error( 'Failed to read appdata' ) );

			await expect( runCommand( 'table' ) ).rejects.toThrow( 'Failed to read appdata' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should list sites with table format', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( 'table' );

			expect( readAppdata ).toHaveBeenCalled();
			expect( consoleSpy ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();

			consoleSpy.mockRestore();
		} );

		it( 'should list sites with json format', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith(
				JSON.stringify(
					[
						{
							id: 'site-1',
							name: 'Test Site 1',
							path: '/path/to/site1',
							port: 8080,
							url: 'http://localhost:8080',
							phpVersion: '8.0',
							running: false,
						},
						{
							id: 'site-2',
							name: 'Test Site 2',
							path: '/path/to/site2',
							port: 8081,
							url: 'http://my-site.wp.local',
							phpVersion: '8.0',
							customDomain: 'my-site.wp.local',
							running: false,
						},
					],
					null,
					2
				)
			);
			expect( disconnectFromDaemon ).toHaveBeenCalled();

			consoleSpy.mockRestore();
		} );

		it( 'should handle no sites found', async () => {
			vi.mocked( readAppdata ).mockResolvedValue( emptyAppdata );

			await runCommand( 'table' );

			expect( readAppdata ).toHaveBeenCalled();
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );

		it( 'should handle custom domain in site URL', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( 'json' );

			expect( consoleSpy ).toHaveBeenCalledWith( expect.stringContaining( 'my-site.wp.local' ) );
			expect( disconnectFromDaemon ).toHaveBeenCalled();

			consoleSpy.mockRestore();
		} );
	} );
} );
