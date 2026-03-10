import { vi } from 'vitest';
import { readCliConfig } from 'cli/lib/cli-config';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { runCommand } from '../list';
vi.mock( 'cli/lib/cli-config', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config' );
	return {
		...actual,
		readCliConfig: vi.fn(),
	};
} );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/wordpress-server-manager' );

describe( 'CLI: studio site list', () => {
	const testCliConfig = {
		version: 1,
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
	};

	const emptyCliConfig = {
		version: 1,
		sites: [],
	};

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( readCliConfig ).mockResolvedValue( testCliConfig );
		vi.mocked( connectToDaemon ).mockResolvedValue( undefined );
		vi.mocked( disconnectFromDaemon ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'should throw when config read fails', async () => {
			vi.mocked( readCliConfig ).mockRejectedValue( new Error( 'Failed to read config' ) );

			await expect( runCommand( 'table' ) ).rejects.toThrow( 'Failed to read config' );
			expect( disconnectFromDaemon ).toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'should list sites with table format', async () => {
			const consoleSpy = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

			await runCommand( 'table' );

			expect( readCliConfig ).toHaveBeenCalled();
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
			vi.mocked( readCliConfig ).mockResolvedValue( emptyCliConfig );

			await runCommand( 'table' );

			expect( readCliConfig ).toHaveBeenCalled();
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
