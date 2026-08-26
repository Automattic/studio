import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWpFilesPath } from 'cli/lib/dependency-management/paths';
import { ensureSqliteIntegrationForImportedSite } from 'cli/lib/sqlite-integration';

vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getWpFilesPath: vi.fn(),
} ) );

const SQLITE_DIRNAME = 'sqlite-database-integration';

describe( 'ensureSqliteIntegrationForImportedSite', () => {
	let tmpDir: string;
	let sitePath: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-sqlite-imported-' ) );

		const wpFilesPath = path.join( tmpDir, 'wp-files' );
		const sourcePath = path.join( wpFilesPath, SQLITE_DIRNAME );
		fs.mkdirSync( path.join( sourcePath, 'wp-includes', 'database' ), { recursive: true } );
		fs.writeFileSync(
			path.join( sourcePath, 'db.copy' ),
			"<?php '{SQLITE_IMPLEMENTATION_FOLDER_PATH}';"
		);
		fs.writeFileSync( path.join( sourcePath, 'wp-includes', 'database', 'load.php' ), '<?php' );
		vi.mocked( getWpFilesPath ).mockReturnValue( wpFilesPath );

		sitePath = path.join( tmpDir, 'site' );
		fs.mkdirSync( path.join( sitePath, 'wp-content' ), { recursive: true } );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	// A full reprint pull replaces wp-content with a symlink into the pull
	// scratch, dropping the drop-in and mu-plugin the blank install had. The
	// site still boots through runtime.php, but phpMyAdmin resolves its SQLite
	// driver from wp-content and needs them back.
	it( 'installs the integration for an imported site that lost it', async () => {
		await ensureSqliteIntegrationForImportedSite( {
			path: sitePath,
			runtimeBlueprintPath: path.join( tmpDir, 'runtime', 'blueprint.json' ),
		} );

		expect(
			fs.existsSync( path.join( sitePath, 'wp-content', 'mu-plugins', SQLITE_DIRNAME ) )
		).toBe( true );
		expect( fs.existsSync( path.join( sitePath, 'wp-content', 'db.php' ) ) ).toBe( true );
	} );

	// The flattened layout a pull leaves behind: the install has to land in the
	// scratch the symlink points at, which is what runtime.php mounts.
	it( 'installs through the flattened wp-content symlink', async () => {
		const scratchContent = path.join( tmpDir, 'raw', 'srv', 'htdocs', 'wp-content' );
		fs.mkdirSync( scratchContent, { recursive: true } );
		fs.rmSync( path.join( sitePath, 'wp-content' ), { recursive: true } );
		fs.symlinkSync( scratchContent, path.join( sitePath, 'wp-content' ) );

		await ensureSqliteIntegrationForImportedSite( {
			path: sitePath,
			runtimeBlueprintPath: path.join( tmpDir, 'runtime', 'blueprint.json' ),
		} );

		expect( fs.existsSync( path.join( scratchContent, 'mu-plugins', SQLITE_DIRNAME ) ) ).toBe(
			true
		);
		expect( fs.existsSync( path.join( scratchContent, 'db.php' ) ) ).toBe( true );
	} );

	it( 'leaves a non-imported site alone', async () => {
		await ensureSqliteIntegrationForImportedSite( { path: sitePath } );

		expect(
			fs.existsSync( path.join( sitePath, 'wp-content', 'mu-plugins', SQLITE_DIRNAME ) )
		).toBe( false );
	} );
} );
