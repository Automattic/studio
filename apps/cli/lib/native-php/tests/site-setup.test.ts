import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureWpConfig } from 'cli/lib/native-php/site-setup';

const runPhpCommand = vi.hoisted( () => vi.fn() );

vi.mock( 'cli/lib/native-php/php-process', () => ( { runPhpCommand } ) );
vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getWpCliPharPath: () => '/wp-cli.phar',
} ) );

// The constants are passed to PHP as the third positional arg, JSON-encoded.
async function getWrittenConstants(
	config?: Parameters< typeof ensureWpConfig >[ 4 ]
): Promise< Record< string, unknown > > {
	runPhpCommand.mockClear();
	await ensureWpConfig(
		'/nonexistent-site',
		'8.4',
		new AbortController().signal,
		'/wp-config-transformer.php',
		config
	);
	const args = runPhpCommand.mock.calls[ 0 ][ 0 ] as string[];
	return JSON.parse( args[ args.length - 1 ] );
}

describe( 'ensureWpConfig', () => {
	beforeEach( () => {
		runPhpCommand.mockResolvedValue( undefined );
	} );

	it( 'defaults both new constants when no config is supplied', async () => {
		const constants = await getWrittenConstants();

		expect( constants.SCRIPT_DEBUG ).toBe( false );
		expect( constants.WP_ENVIRONMENT_TYPE ).toBe( 'local' );
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
