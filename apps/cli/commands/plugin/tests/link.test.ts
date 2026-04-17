import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { LoggerError } from 'cli/logger';
import { runCommand } from '../link';

vi.mock( 'fs', () => {
	const promises = {
		stat: vi.fn(),
		lstat: vi.fn(),
		readdir: vi.fn(),
		readFile: vi.fn(),
		readlink: vi.fn(),
		mkdir: vi.fn(),
		symlink: vi.fn(),
		unlink: vi.fn(),
	};
	return { default: { promises }, promises };
} );
vi.mock( '@studio/common/lib/fs-utils', () => ( {
	pathExists: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/sites', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/sites' );
	return {
		...( actual as object ),
		getSiteByFolder: vi.fn(),
	};
} );

describe( 'CLI: studio plugin link', () => {
	// Use `path.resolve` so the mocked pathExists comparison matches the
	// platform-specific absolute form that runCommand computes (e.g. `C:\…` on Windows).
	const testSiteFolder = path.resolve( '/test/site/path' );
	const testSourcePath = path.resolve( '/test/plugins/my-plugin' );
	const pluginsDir = path.join( testSiteFolder, 'wp-content', 'plugins' );
	const targetPath = path.join( pluginsDir, 'my-plugin' );

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getSiteByFolder ).mockResolvedValue( {
			id: 'test-site-id',
			name: 'Test Site',
			path: testSiteFolder,
			port: 8881,
			phpVersion: '8.0',
		} );

		// Default: source exists, target does not.
		vi.mocked( pathExists ).mockImplementation( async ( p: string ) => p === testSourcePath );
		vi.mocked( fs.promises.stat ).mockResolvedValue( {
			isDirectory: () => true,
		} as fs.Stats );
		vi.mocked( fs.promises.readdir ).mockResolvedValue( [ 'my-plugin.php' ] as unknown as never );
		vi.mocked( fs.promises.readFile ).mockResolvedValue(
			'<?php\n/*\nPlugin Name: My Plugin\n*/' as unknown as never
		);
		vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
		vi.mocked( fs.promises.symlink ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'throws when site not found', async () => {
			vi.mocked( getSiteByFolder ).mockRejectedValue( new Error( 'Site not found' ) );

			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow(
				'Site not found'
			);
		} );

		it( 'throws when source path does not exist', async () => {
			vi.mocked( pathExists ).mockResolvedValue( false );

			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow( LoggerError );
			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow(
				/Source path does not exist/
			);
		} );

		it( 'throws when source is not a directory', async () => {
			vi.mocked( fs.promises.stat ).mockResolvedValue( {
				isDirectory: () => false,
			} as fs.Stats );

			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow(
				/Source path is not a directory/
			);
		} );

		it( 'throws when directory has no PHP file with Plugin Name header', async () => {
			vi.mocked( fs.promises.readFile ).mockResolvedValue(
				'<?php\n// no header here' as unknown as never
			);

			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow(
				/does not appear to be a valid WordPress plugin/
			);
		} );

		it( 'throws when directory has no PHP files at all', async () => {
			vi.mocked( fs.promises.readdir ).mockResolvedValue( [ 'README.md' ] as unknown as never );

			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow(
				/does not appear to be a valid WordPress plugin/
			);
		} );

		it( 'throws when target exists as a non-symlink directory', async () => {
			vi.mocked( pathExists ).mockResolvedValue( true );
			vi.mocked( fs.promises.lstat ).mockResolvedValue( {
				isSymbolicLink: () => false,
			} as fs.Stats );

			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow(
				/already exists/
			);
			expect( fs.promises.symlink ).not.toHaveBeenCalled();
		} );

		it( 'throws when target is a symlink to a different source', async () => {
			vi.mocked( pathExists ).mockResolvedValue( true );
			vi.mocked( fs.promises.lstat ).mockResolvedValue( {
				isSymbolicLink: () => true,
			} as fs.Stats );
			vi.mocked( fs.promises.readlink ).mockResolvedValue( '/some/other/plugin' );

			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow(
				/already linked to a different location/
			);
		} );

		it( 'throws when source resolves to filesystem root (empty basename)', async () => {
			const fsRoot = path.resolve( '/' );
			vi.mocked( pathExists ).mockImplementation( async ( p: string ) => p === fsRoot );

			await expect( runCommand( testSiteFolder, fsRoot ) ).rejects.toThrow(
				/Could not determine a valid plugin name/
			);
			expect( fs.promises.symlink ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'creates a relative symlink for a valid plugin', async () => {
			await runCommand( testSiteFolder, testSourcePath );

			expect( fs.promises.mkdir ).toHaveBeenCalledWith( pluginsDir, { recursive: true } );
			expect( fs.promises.symlink ).toHaveBeenCalledTimes( 1 );
			const [ linkPath, finalTarget ] = vi.mocked( fs.promises.symlink ).mock.calls[ 0 ];
			expect( finalTarget ).toBe( targetPath );
			expect( linkPath ).toBe( path.relative( pluginsDir, testSourcePath ) );
		} );

		it( 'is a no-op when plugin is already linked to the same source', async () => {
			vi.mocked( pathExists ).mockResolvedValue( true );
			vi.mocked( fs.promises.lstat ).mockResolvedValue( {
				isSymbolicLink: () => true,
			} as fs.Stats );
			vi.mocked( fs.promises.readlink ).mockResolvedValue(
				path.relative( pluginsDir, testSourcePath )
			);

			await runCommand( testSiteFolder, testSourcePath );

			expect( fs.promises.symlink ).not.toHaveBeenCalled();
		} );

		it( 'uses current directory when source is omitted', async () => {
			const cwd = process.cwd();
			const cwdPluginName = path.basename( cwd );
			const expectedTarget = path.join( pluginsDir, cwdPluginName );

			vi.mocked( pathExists ).mockImplementation( async ( p: string ) => p === cwd );
			vi.mocked( fs.promises.readdir ).mockResolvedValue( [ 'my-plugin.php' ] as unknown as never );
			vi.mocked( fs.promises.readFile ).mockResolvedValue(
				'<?php\n/*\nPlugin Name: My Plugin\n*/' as unknown as never
			);

			await runCommand( testSiteFolder );

			expect( fs.promises.symlink ).toHaveBeenCalledTimes( 1 );
			const [ , finalTarget ] = vi.mocked( fs.promises.symlink ).mock.calls[ 0 ];
			expect( finalTarget ).toBe( expectedTarget );
		} );

		it( 'detects Plugin Name header in any PHP file in the directory', async () => {
			vi.mocked( fs.promises.readdir ).mockResolvedValue( [
				'helper.php',
				'main.php',
			] as unknown as never );
			vi.mocked( fs.promises.readFile ).mockImplementation( async ( filePath ) => {
				if ( String( filePath ).endsWith( 'main.php' ) ) {
					return '<?php\n/*\nPlugin Name: My Plugin\n*/' as unknown as never;
				}
				return '<?php\n// no header' as unknown as never;
			} );

			await runCommand( testSiteFolder, testSourcePath );

			expect( fs.promises.symlink ).toHaveBeenCalled();
		} );
	} );
} );
