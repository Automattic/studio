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

describe( 'CLI: studio theme link', () => {
	// Use `path.resolve` so the mocked pathExists comparison matches the
	// platform-specific absolute form that runCommand computes (e.g. `C:\…` on Windows).
	const testSiteFolder = path.resolve( '/test/site/path' );
	const testSourcePath = path.resolve( '/test/themes/my-theme' );
	const themesDir = path.join( testSiteFolder, 'wp-content', 'themes' );
	const targetPath = path.join( themesDir, 'my-theme' );
	const styleCssPath = path.join( testSourcePath, 'style.css' );

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getSiteByFolder ).mockResolvedValue( {
			id: 'test-site-id',
			name: 'Test Site',
			path: testSiteFolder,
			port: 8881,
			phpVersion: '8.0',
		} );

		// Default: source exists (incl. style.css), target does not.
		vi.mocked( pathExists ).mockImplementation(
			async ( p: string ) => p === testSourcePath || p === styleCssPath
		);
		vi.mocked( fs.promises.stat ).mockResolvedValue( {
			isDirectory: () => true,
		} as fs.Stats );
		vi.mocked( fs.promises.readFile ).mockResolvedValue(
			'/*\nTheme Name: My Theme\n*/' as unknown as never
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

		it( 'throws when style.css is missing', async () => {
			vi.mocked( pathExists ).mockImplementation( async ( p: string ) => p === testSourcePath );

			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow(
				/does not appear to be a valid WordPress theme/
			);
		} );

		it( 'throws when style.css lacks Theme Name header', async () => {
			vi.mocked( fs.promises.readFile ).mockResolvedValue( '/* no header */' as unknown as never );

			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow(
				/does not appear to be a valid WordPress theme/
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
			vi.mocked( fs.promises.readlink ).mockResolvedValue( '/some/other/theme' );

			await expect( runCommand( testSiteFolder, testSourcePath ) ).rejects.toThrow(
				/already linked to a different location/
			);
		} );

		it( 'throws when source resolves to filesystem root (empty basename)', async () => {
			const fsRoot = path.resolve( '/' );
			const rootStyleCss = path.join( fsRoot, 'style.css' );
			vi.mocked( pathExists ).mockImplementation(
				async ( p: string ) => p === fsRoot || p === rootStyleCss
			);
			vi.mocked( fs.promises.readFile ).mockResolvedValue(
				'/*\nTheme Name: Root Theme\n*/' as unknown as never
			);

			await expect( runCommand( testSiteFolder, fsRoot ) ).rejects.toThrow(
				/Could not determine a valid theme directory name/
			);
			expect( fs.promises.symlink ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'Success Cases', () => {
		it( 'creates a relative symlink for a valid theme', async () => {
			await runCommand( testSiteFolder, testSourcePath );

			expect( fs.promises.mkdir ).toHaveBeenCalledWith( themesDir, { recursive: true } );
			expect( fs.promises.symlink ).toHaveBeenCalledTimes( 1 );
			const [ linkPath, finalTarget ] = vi.mocked( fs.promises.symlink ).mock.calls[ 0 ];
			expect( finalTarget ).toBe( targetPath );
			expect( linkPath ).toBe( path.relative( themesDir, testSourcePath ) );
		} );

		it( 'uses current directory when source is omitted', async () => {
			const cwd = process.cwd();
			const cwdThemeName = path.basename( cwd );
			const expectedTarget = path.join( themesDir, cwdThemeName );
			const cwdStyleCss = path.join( cwd, 'style.css' );

			vi.mocked( pathExists ).mockImplementation(
				async ( p: string ) => p === cwd || p === cwdStyleCss
			);
			vi.mocked( fs.promises.readFile ).mockResolvedValue(
				'/*\nTheme Name: My Theme\n*/' as unknown as never
			);

			await runCommand( testSiteFolder );

			expect( fs.promises.symlink ).toHaveBeenCalledTimes( 1 );
			const [ , finalTarget ] = vi.mocked( fs.promises.symlink ).mock.calls[ 0 ];
			expect( finalTarget ).toBe( expectedTarget );
		} );

		it( 'is a no-op when theme is already linked to the same source', async () => {
			vi.mocked( pathExists ).mockResolvedValue( true );
			vi.mocked( fs.promises.lstat ).mockResolvedValue( {
				isSymbolicLink: () => true,
			} as fs.Stats );
			vi.mocked( fs.promises.readlink ).mockResolvedValue(
				path.relative( themesDir, testSourcePath )
			);

			await runCommand( testSiteFolder, testSourcePath );

			expect( fs.promises.symlink ).not.toHaveBeenCalled();
		} );
	} );
} );
