import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted( () => ( {
	readConfig: vi.fn(),
	deleteSite: vi.fn().mockResolvedValue( undefined ),
	resolveProvider: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: mocks.readConfig,
	lockCliConfig: vi.fn(),
	unlockCliConfig: vi.fn(),
	saveCliConfig: vi.fn(),
} ) );
vi.mock( 'cli/commands/site/delete', () => ( { runCommand: mocks.deleteSite } ) );
vi.mock( 'cli/commands/site/create', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/site/stop', () => ( { Mode: {}, runCommand: vi.fn() } ) );
vi.mock( 'cli/ai/auth', () => ( {
	resolveInitialAiProvider: mocks.resolveProvider,
	resolveUnavailableAiProvider: vi.fn(),
	resolveAiEnvironment: vi.fn().mockResolvedValue( {} ),
} ) );
vi.mock( 'cli/ai/runtimes/pi', () => ( {
	runStudioAgentTurn: () => ( { result: Promise.resolve(), interrupt: vi.fn() } ),
} ) );
vi.mock( 'cli/ai/eval-outcome', () => ( {
	fingerprintSites: vi.fn(),
	captureTurnOutcome: vi.fn().mockResolvedValue( {} ),
} ) );

const roots: string[] = [];
afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for ( const root of roots.splice( 0 ) ) rmSync( root, { recursive: true, force: true } );
} );

it.each( [
	[ false, false ],
	[ true, false ],
	[ false, true ],
] )( 'cleans the case root (failure=%s, keep=%s)', async ( failure, keep ) => {
	vi.resetModules();
	mocks.deleteSite.mockClear();
	const root = mkdtempSync( path.join( os.tmpdir(), 'studio-eval-sites-test-' ) );
	roots.push( root );
	vi.spyOn( os, 'tmpdir' ).mockReturnValue( root );
	const sitePath = path.join( root, 'agent-created' );
	mkdirSync( sitePath );
	writeFileSync( path.join( sitePath, 'index.php' ), '<?php' );
	mocks.readConfig.mockResolvedValue( {
		sites: [ { path: sitePath }, { path: `${ root }-outside` } ],
	} );
	mocks.resolveProvider.mockImplementation( () => {
		if ( failure ) throw new Error( 'case failed' );
		return 'wpcom';
	} );
	vi.stubEnv( 'E2E', '1' );
	vi.stubEnv( 'E2E_CLI_CONFIG_PATH', root );
	vi.stubEnv( 'E2E_SITES_ROOT', root );
	vi.stubEnv( 'STUDIO_EVAL_KEEP_SITES', keep ? '1' : '' );
	vi.spyOn( process, 'argv', 'get' ).mockReturnValue( [ 'node', 'runner', 'prompt' ] );
	const stdout = process.stdout.write;
	const stderr = vi.spyOn( process.stderr, 'write' ).mockReturnValue( true );
	const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
	try {
		await import( '../eval-runner' );
		await vi.waitFor( () => expect( exit ).toHaveBeenCalledWith( failure ? 1 : 0 ) );
		expect( existsSync( root ) ).toBe( keep );
		if ( keep ) {
			expect( stderr ).toHaveBeenCalledWith( expect.stringContaining( root ) );
			expect( mocks.deleteSite ).not.toHaveBeenCalledWith( sitePath, true, expect.anything() );
		} else {
			expect( mocks.deleteSite ).toHaveBeenCalledWith( sitePath, true, expect.anything() );
		}
		expect( mocks.deleteSite ).not.toHaveBeenCalledWith(
			`${ root }-outside`,
			true,
			expect.anything()
		);
	} finally {
		process.stdout.write = stdout;
	}
} );
