import fs from 'fs';
import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { generateBackupFilename } from '@studio/common/lib/generate-backup-filename';
import { move } from 'fs-extra';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { loadDatabase } from 'cli/lib/site-database/dump-load';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'fs', () => ( { default: { promises: { rm: vi.fn() } } } ) );
vi.mock( 'fs-extra' );
vi.mock( 'cli/lib/run-wp-cli-command' );
vi.mock( '@studio/common/lib/generate-backup-filename' );

const site = { path: '/site' } as SiteData;

describe( 'loadDatabase', () => {
	const prepareSqlFile = vi.fn().mockResolvedValue( undefined );
	const onProgress = vi.fn();
	const options = { phpVersion: DEFAULT_PHP_VERSION, prepareSqlFile, onProgress };

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( generateBackupFilename ).mockReturnValue( 'temporary' );
		vi.mocked( runWpCliCommand ).mockResolvedValue( {
			response: {
				exitCode: Promise.resolve( 0 ),
				stderrText: Promise.resolve( '' ),
			},
			[ Symbol.dispose ]: vi.fn(),
		} as unknown as Awaited< ReturnType< typeof runWpCliCommand > > );
	} );

	it( 'loads files in sorted order, preparing each temporary file and reporting progress', async () => {
		await loadDatabase( site, [ '/backup/b.sql', '/backup/a.sql' ], options );
		expect( onProgress.mock.calls ).toEqual( [
			[ '/backup/a.sql', 1, 2 ],
			[ '/backup/b.sql', 2, 2 ],
		] );
		const temporaryPath = path.join( site.path, 'temporary.sql' );
		expect( move ).toHaveBeenNthCalledWith( 1, '/backup/a.sql', temporaryPath );
		expect( prepareSqlFile ).toHaveBeenCalledWith( temporaryPath );
		expect( runWpCliCommand ).toHaveBeenCalledWith(
			site,
			[
				'sqlite',
				'import',
				'temporary.sql',
				'--enable-ast-driver',
				'--skip-plugins',
				'--skip-themes',
			],
			{ requireSqliteCliCommand: true, phpVersion: DEFAULT_PHP_VERSION }
		);
		expect( fs.promises.rm ).toHaveBeenCalledTimes( 2 );
		expect( fs.promises.rm ).toHaveBeenCalledWith( temporaryPath, {
			recursive: true,
			force: true,
		} );
	} );

	it( 'does nothing for an empty file list', async () => {
		await loadDatabase( site, [], options );
		expect( runWpCliCommand ).not.toHaveBeenCalled();
		expect( onProgress ).not.toHaveBeenCalled();
	} );

	it( 'preserves import error output and cleans up after a failed command', async () => {
		const stderr = 'Deprecated: noise\nError: invalid SQL';
		vi.mocked( runWpCliCommand ).mockResolvedValueOnce( {
			response: { exitCode: Promise.resolve( 1 ), stderrText: Promise.resolve( stderr ) },
			[ Symbol.dispose ]: vi.fn(),
		} as unknown as Awaited< ReturnType< typeof runWpCliCommand > > );
		const consoleError = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		try {
			await expect( loadDatabase( site, [ '/backup/a.sql' ], options ) ).rejects.toMatchObject( {
				message: 'Database import failed: Error: invalid SQL',
				code: 'database_import',
			} );
			expect( consoleError ).toHaveBeenCalledWith(
				'Error during import of /backup/a.sql:',
				stderr
			);
			expect( fs.promises.rm ).toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	} );

	it( 'cleans up the temporary file when preparation fails', async () => {
		prepareSqlFile.mockRejectedValueOnce( new Error( 'preparation failed' ) );
		await expect( loadDatabase( site, [ '/backup/a.sql' ], options ) ).rejects.toThrow(
			'preparation failed'
		);
		expect( fs.promises.rm ).toHaveBeenCalledWith( path.join( site.path, 'temporary.sql' ), {
			recursive: true,
			force: true,
		} );
		expect( runWpCliCommand ).not.toHaveBeenCalled();
	} );
} );
