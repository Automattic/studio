import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { vi } from 'vitest';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { runCommand } from '../unlink';

vi.mock( 'fs', () => {
	const promises = {
		lstat: vi.fn(),
		readlink: vi.fn(),
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

describe( 'CLI: studio plugin unlink', () => {
	const testSiteFolder = '/test/site/path';
	const pluginsDir = path.join( testSiteFolder, 'wp-content', 'plugins' );
	const pluginName = 'my-plugin';
	const targetPath = path.join( pluginsDir, pluginName );
	const sourcePath = '/test/plugins/my-plugin';

	beforeEach( () => {
		vi.clearAllMocks();

		vi.mocked( getSiteByFolder ).mockResolvedValue( {
			id: 'test-site-id',
			name: 'Test Site',
			path: testSiteFolder,
			port: 8881,
			phpVersion: '8.0',
		} );

		vi.mocked( pathExists ).mockResolvedValue( true );
		vi.mocked( fs.promises.lstat ).mockResolvedValue( {
			isSymbolicLink: () => true,
		} as fs.Stats );
		vi.mocked( fs.promises.readlink ).mockResolvedValue( path.relative( pluginsDir, sourcePath ) );
		vi.mocked( fs.promises.unlink ).mockResolvedValue( undefined );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Error Cases', () => {
		it( 'throws when plugin does not exist in site', async () => {
			vi.mocked( pathExists ).mockResolvedValue( false );

			await expect( runCommand( testSiteFolder, pluginName ) ).rejects.toThrow(
				/not found in site/
			);
			expect( fs.promises.unlink ).not.toHaveBeenCalled();
		} );

		it( 'throws when target exists but is not a symlink', async () => {
			vi.mocked( fs.promises.lstat ).mockResolvedValue( {
				isSymbolicLink: () => false,
			} as fs.Stats );

			await expect( runCommand( testSiteFolder, pluginName ) ).rejects.toThrow(
				/is not a linked plugin/
			);
			expect( fs.promises.unlink ).not.toHaveBeenCalled();
		} );

		it( 'throws when site not found', async () => {
			vi.mocked( getSiteByFolder ).mockRejectedValue( new Error( 'Site not found' ) );

			await expect( runCommand( testSiteFolder, pluginName ) ).rejects.toThrow( 'Site not found' );
		} );

		it.each( [ '../evil', '../../etc', 'foo/bar', 'a/b/c' ] )(
			'rejects path traversal in plugin name: %s',
			async ( malicious ) => {
				await expect( runCommand( testSiteFolder, malicious ) ).rejects.toThrow(
					/Invalid plugin name/
				);
				expect( fs.promises.unlink ).not.toHaveBeenCalled();
				expect( fs.promises.lstat ).not.toHaveBeenCalled();
			}
		);
	} );

	describe( 'Success Cases', () => {
		it( 'removes the symlink and preserves the source', async () => {
			await runCommand( testSiteFolder, pluginName );

			expect( fs.promises.unlink ).toHaveBeenCalledWith( targetPath );
			expect( fs.promises.readlink ).toHaveBeenCalledWith( targetPath );
		} );
	} );
} );
