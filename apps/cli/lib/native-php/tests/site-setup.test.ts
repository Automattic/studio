import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureWpConfig } from 'cli/lib/native-php/site-setup';

const runPhpCommand = vi.hoisted( () => vi.fn() );
const isSqliteIntegrationInstalled = vi.hoisted( () => vi.fn() );

vi.mock( 'cli/lib/native-php/php-process', () => ( { runPhpCommand } ) );
vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getWpCliPharPath: () => '/wp-cli.phar',
} ) );
vi.mock( 'cli/lib/dependency-management/php-binary', () => ( {
	ensurePhpBinaryAvailable: vi.fn(),
} ) );
vi.mock( 'cli/lib/sqlite-integration', () => ( {
	isSqliteIntegrationInstalled,
} ) );

// The script's arguments after `-r <script>`: the transformer path, the wp-config.php path, the
// constants to write and the constants to write only when undefined, both JSON-encoded.
async function getScriptArgs(
	config?: Parameters< typeof ensureWpConfig >[ 3 ]
): Promise< string[] > {
	runPhpCommand.mockClear();
	await ensureWpConfig( '/nonexistent-site', '8.4', new AbortController().signal, config );
	return ( runPhpCommand.mock.calls[ 0 ][ 0 ] as string[] ).slice( 2 );
}

async function getWrittenConstants(
	config?: Parameters< typeof ensureWpConfig >[ 3 ]
): Promise< Record< string, unknown > > {
	return JSON.parse( ( await getScriptArgs( config ) )[ 2 ] );
}

describe( 'ensureWpConfig', () => {
	beforeEach( () => {
		isSqliteIntegrationInstalled.mockResolvedValue( false );
		runPhpCommand.mockResolvedValue( undefined );
	} );

	it( 'defaults both new constants when no config is supplied', async () => {
		const constants = await getWrittenConstants();

		expect( constants.SCRIPT_DEBUG ).toBe( false );
		expect( constants.WP_ENVIRONMENT_TYPE ).toBe( 'local' );
	} );

	// WordPress caches theme patterns and theme.json outside theme development mode, so a pattern
	// added to a theme wouldn't show up.
	it( 'enables theme development mode unless wp-config.php already sets a mode', async () => {
		const [ , , constants, constantsIfUndefined ] = await getScriptArgs();

		expect( JSON.parse( constants ) ).not.toHaveProperty( 'WP_DEVELOPMENT_MODE' );
		expect( JSON.parse( constantsIfUndefined ) ).toEqual( { WP_DEVELOPMENT_MODE: 'theme' } );
	} );

	it( 'omits DB_NAME when the SQLite integration is not installed', async () => {
		const constants = await getWrittenConstants();

		expect( constants ).not.toHaveProperty( 'DB_NAME' );
	} );

	it( 'writes SCRIPT_DEBUG when script debug is enabled', async () => {
		const constants = await getWrittenConstants( { enableScriptDebug: true } );

		expect( constants.SCRIPT_DEBUG ).toBe( true );
	} );

	// SCRIPT_DEBUG is independent of WP_DEBUG in WordPress. Enabling it must not
	// turn on WP_DEBUG as a side effect.
	it( 'does not enable WP_DEBUG when only SCRIPT_DEBUG is enabled', async () => {
		const constants = await getWrittenConstants( { enableScriptDebug: true } );

		expect( constants.WP_DEBUG ).toBe( false );
		expect( constants.WP_DEBUG_LOG ).toBe( false );
		expect( constants.WP_DEBUG_DISPLAY ).toBe( false );
	} );

	it( 'writes the configured environment type', async () => {
		const constants = await getWrittenConstants( { environmentType: 'staging' } );

		expect( constants.WP_ENVIRONMENT_TYPE ).toBe( 'staging' );
	} );

	it( 'still derives WP_DEBUG from the debug log and display flags', async () => {
		const constants = await getWrittenConstants( { enableDebugLog: true } );

		expect( constants.WP_DEBUG ).toBe( true );
		expect( constants.WP_DEBUG_LOG ).toBe( true );
	} );
} );
