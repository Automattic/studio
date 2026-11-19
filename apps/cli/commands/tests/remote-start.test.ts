import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalServer } from '@studio/local';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { capturePreview } from 'cli/lib/capture-preview';
import { mockReportError, mockReportSuccess } from 'cli/tests/test-utils';
import { runCommand } from '../remote/start';

vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportSuccess = mockReportSuccess;
		reportError = mockReportError;
	},
	LoggerError: class LoggerError extends Error {},
} ) );
vi.mock( '@studio/local', () => ( {
	startLocalServer: vi.fn().mockResolvedValue( { url: 'http://127.0.0.1:8098', close: vi.fn() } ),
} ) );
vi.mock( 'cli/lib/remote-pairing', () => ( { printPairingCode: vi.fn() } ) );

let configDir: string;

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-start-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	vi.stubGlobal( '__STUDIO_CLI_VERSION__', 'test-version' );
	// The command waits for Ctrl+C; the test does not.
	vi.spyOn( process, 'on' ).mockImplementation( () => process );
} );

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( "gives the server the capture that takes the phone's screenshots", async () => {
	await runCommand( { host: '127.0.0.1', port: 8098 } );

	expect( mockReportError ).not.toHaveBeenCalled();
	expect( startLocalServer ).toHaveBeenCalledWith(
		expect.objectContaining( { host: '127.0.0.1', port: 8098, capturePreview } )
	);
} );
