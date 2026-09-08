import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureWpConfig } from '../site-setup';

const { ensurePhpBinaryAvailable, isSqliteIntegrationInstalled, runPhpCommand } = vi.hoisted(
	() => ( {
		ensurePhpBinaryAvailable: vi.fn( async () => undefined ),
		isSqliteIntegrationInstalled: vi.fn( async () => false ),
		runPhpCommand: vi.fn(),
	} )
);

vi.mock( '../../dependency-management/php-binary', () => ( {
	ensurePhpBinaryAvailable,
} ) );

vi.mock( '../php-process', () => ( {
	runPhpCommand,
} ) );

vi.mock( 'cli/lib/sqlite-integration', () => ( {
	isSqliteIntegrationInstalled,
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
		isSqliteIntegrationInstalled.mockReset();
		isSqliteIntegrationInstalled.mockResolvedValue( false );
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

	it.each( [
		{
			name: 'replaces the sample placeholder for SQLite',
			sqliteInstalled: true,
			input: [ "define( 'DB_NAME', 'database_name_here' );" ],
			expected: [ "define( 'DB_NAME', 'wordpress' );" ],
		},
		{
			name: 'replaces an empty value for SQLite',
			sqliteInstalled: true,
			input: [ "define( 'DB_NAME', '' );" ],
			expected: [ "define( 'DB_NAME', 'wordpress' );" ],
		},
		{
			name: 'replaces a dynamic value for SQLite',
			sqliteInstalled: true,
			input: [ "define( 'DB_NAME', getenv( 'DB_NAME' ) );" ],
			expected: [ "define( 'DB_NAME', 'wordpress' );" ],
		},
		{
			name: 'replaces every duplicate value for SQLite',
			sqliteInstalled: true,
			input: [
				"define( 'DB_NAME', 'database_name_here' );",
				"define( 'DB_NAME', 'database_demo' );",
			],
			expected: [ "define( 'DB_NAME', 'wordpress' );", "define( 'DB_NAME', 'wordpress' );" ],
		},
		{
			name: 'preserves an empty value for external MySQL',
			sqliteInstalled: false,
			input: [ "define( 'DB_NAME', '' );" ],
			expected: [ "define( 'DB_NAME', '' );" ],
		},
		{
			name: 'preserves a dynamic value for external MySQL',
			sqliteInstalled: false,
			input: [ "define( 'DB_NAME', getenv( 'DB_NAME' ) );" ],
			expected: [ "define( 'DB_NAME', getenv( 'DB_NAME' ) );" ],
		},
		{
			name: 'preserves duplicate external values when the sample comes first',
			sqliteInstalled: false,
			input: [
				"define( 'DB_NAME', 'database_name_here' );",
				"define( 'DB_NAME', 'database_demo' );",
			],
			expected: [
				"define( 'DB_NAME', 'database_name_here' );",
				"define( 'DB_NAME', 'database_demo' );",
			],
		},
		{
			name: 'preserves duplicate external values when the sample comes second',
			sqliteInstalled: false,
			input: [
				"define( 'DB_NAME', 'database_demo' );",
				"define( 'DB_NAME', 'database_name_here' );",
			],
			expected: [
				"define( 'DB_NAME', 'database_demo' );",
				"define( 'DB_NAME', 'database_name_here' );",
			],
		},
	] )( '$name', async ( { sqliteInstalled, input, expected } ) => {
		isSqliteIntegrationInstalled.mockResolvedValue( sqliteInstalled );
		const wpConfigPath = path.join( tmpDir, 'wp-config.php' );
		fs.writeFileSync( wpConfigPath, `<?php\n${ input.join( '\n' ) }\n` );

		await ensureWpConfig( tmpDir, PHP_VERSION );

		const databaseDefinitions = fs
			.readFileSync( wpConfigPath, 'utf8' )
			.split( '\n' )
			.filter( ( line ) => line.startsWith( "define( 'DB_NAME'" ) );
		expect( databaseDefinitions ).toEqual( expected );
	} );

	it( 'ignores a commented-out external database name', async () => {
		isSqliteIntegrationInstalled.mockResolvedValue( true );
		const wpConfigPath = path.join( tmpDir, 'wp-config.php' );
		fs.writeFileSync( wpConfigPath, "<?php\n// define( 'DB_NAME', 'database_demo' );\n" );

		await ensureWpConfig( tmpDir, PHP_VERSION );

		expect( fs.readFileSync( wpConfigPath, 'utf8' ) ).toContain(
			"define( 'DB_NAME', 'wordpress' );"
		);
	} );
} );
