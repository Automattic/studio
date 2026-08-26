import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureWpConfig } from '../site-setup';

const { ensurePhpBinaryAvailable, runPhpCommand } = vi.hoisted( () => ( {
	ensurePhpBinaryAvailable: vi.fn( async () => undefined ),
	runPhpCommand: vi.fn(),
} ) );

vi.mock( '../../dependency-management/php-binary', () => ( {
	ensurePhpBinaryAvailable,
} ) );

vi.mock( '../php-process', () => ( {
	runPhpCommand,
} ) );

const PHP_VERSION = '8.4' as Parameters< typeof ensureWpConfig >[ 1 ];
const TRANSFORMER_PATH = path.resolve(
	import.meta.dirname,
	'../../../php/wp-config-transformer.php'
);

function phpAvailable(): boolean {
	try {
		execFileSync( 'php', [ '--version' ], { stdio: 'ignore' } );
		return true;
	} catch {
		return false;
	}
}

describe.skipIf( ! phpAvailable() )( 'ensureWpConfig', () => {
	let tmpDir: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-site-setup-' ) );
		ensurePhpBinaryAvailable.mockClear();
		runPhpCommand.mockImplementation( async ( args: string[] ) => {
			const [ , script, , wpConfigPath, constants ] = args;
			const runnerPath = path.join( tmpDir, 'run-transformer.php' );
			fs.writeFileSync( runnerPath, `<?php\n${ script }` );
			execFileSync( 'php', [ runnerPath, TRANSFORMER_PATH, wpConfigPath, constants ], {
				stdio: 'pipe',
			} );
		} );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'preserves an external database name while updating debug constants', async () => {
		const wpConfigPath = path.join( tmpDir, 'wp-config.php' );
		fs.writeFileSync(
			wpConfigPath,
			"<?php\ndefine( 'DB_NAME', 'database_demo' );\ndefine( 'WP_DEBUG', true );\n"
		);

		await ensureWpConfig( tmpDir, PHP_VERSION );

		const contents = fs.readFileSync( wpConfigPath, 'utf8' );
		expect( contents ).toContain( "define( 'DB_NAME', 'database_demo' );" );
		expect( contents ).toContain( "define( 'WP_DEBUG', false );" );
	} );

	it( 'replaces the WordPress sample database placeholder for local sites', async () => {
		const wpConfigPath = path.join( tmpDir, 'wp-config.php' );
		fs.writeFileSync( wpConfigPath, "<?php\ndefine( 'DB_NAME', 'database_name_here' );\n" );

		await ensureWpConfig( tmpDir, PHP_VERSION );

		expect( fs.readFileSync( wpConfigPath, 'utf8' ) ).toContain(
			"define( 'DB_NAME', 'wordpress' );"
		);
	} );

	it( 'ignores a commented-out external database name', async () => {
		const wpConfigPath = path.join( tmpDir, 'wp-config.php' );
		fs.writeFileSync( wpConfigPath, "<?php\n// define( 'DB_NAME', 'database_demo' );\n" );

		await ensureWpConfig( tmpDir, PHP_VERSION );

		expect( fs.readFileSync( wpConfigPath, 'utf8' ) ).toContain(
			"define( 'DB_NAME', 'wordpress' );"
		);
	} );
} );
