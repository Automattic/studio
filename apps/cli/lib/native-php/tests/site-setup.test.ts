import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureWpConfig } from '../site-setup';

// runPhpCommand is only reached on the healthy paths; the clobber guard throws
// before it. Mock it so "healthy path" tests don't need a real PHP binary and
// so we can assert whether the write was attempted at all.
const { runPhpCommand } = vi.hoisted( () => ( {
	runPhpCommand: vi.fn( async () => undefined ),
} ) );
vi.mock( '../php-process', () => ( {
	runPhpCommand,
} ) );

const PHP_VERSION = '8.3' as Parameters< typeof ensureWpConfig >[ 1 ];
const TRANSFORMER = '/does/not/matter/wp-config-transformer.php';

function writeWpConfig( dir: string, dbName: string ): string {
	const file = path.join( dir, 'wp-config.php' );
	fs.writeFileSync( file, `<?php\ndefine( 'DB_NAME', '${ dbName }' );\n`, 'utf8' );
	return file;
}

describe( 'ensureWpConfig DB_NAME clobber guard', () => {
	let tmpDir: string;

	beforeEach( () => {
		runPhpCommand.mockClear();
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'site-setup-test-' ) );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'refuses to overwrite a non-default DB_NAME when the engine config is missing', async () => {
		// This is the real corruption case: a converted MySQL site whose engine
		// flag was dropped upstream. Writing the SQLite default would sever it
		// from its database, so ensureWpConfig must throw before writing.
		writeWpConfig( tmpDir, 'studio_abc123' );

		await expect(
			ensureWpConfig( tmpDir, PHP_VERSION, new AbortController().signal, TRANSFORMER )
		).rejects.toThrow( /studio_abc123/ );

		expect( runPhpCommand ).not.toHaveBeenCalled();
	} );

	it( 'writes normally when the existing DB_NAME is already the default', async () => {
		// A fresh SQLite site already carries DB_NAME='wordpress'; re-running the
		// default write is a no-op and must not trip the guard.
		writeWpConfig( tmpDir, 'wordpress' );

		await expect(
			ensureWpConfig( tmpDir, PHP_VERSION, new AbortController().signal, TRANSFORMER )
		).resolves.toBeUndefined();

		expect( runPhpCommand ).toHaveBeenCalledOnce();
	} );

	it( 'writes normally when no wp-config.php exists yet', async () => {
		// First-run sites have no wp-config.php (only the sample); there is
		// nothing to clobber.
		fs.writeFileSync( path.join( tmpDir, 'wp-config-sample.php' ), '<?php\n', 'utf8' );

		await expect(
			ensureWpConfig( tmpDir, PHP_VERSION, new AbortController().signal, TRANSFORMER )
		).resolves.toBeUndefined();

		expect( runPhpCommand ).toHaveBeenCalledOnce();
	} );

	it( 'writes normally when wp-config.php was copied from the WordPress sample', async () => {
		// First-run sites copy wp-config-sample.php before writing constants. The
		// sample placeholder is not a real database and is safe to replace.
		writeWpConfig( tmpDir, 'database_name_here' );

		await expect(
			ensureWpConfig( tmpDir, PHP_VERSION, new AbortController().signal, TRANSFORMER )
		).resolves.toBeUndefined();

		expect( runPhpCommand ).toHaveBeenCalledOnce();
	} );
} );
