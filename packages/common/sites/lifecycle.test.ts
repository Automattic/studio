import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CliCommandError, type ExecuteCliCommand } from '@studio/common/lib/cli-process';
import { SiteStartRefusedError, startSite } from '@studio/common/sites/lifecycle';

function failingWith( lastErrorMessage: string ): ExecuteCliCommand {
	return ( () => {
		const emitter = new EventEmitter();
		setImmediate( () =>
			emitter.emit( 'failure', {
				error: new CliCommandError( {
					lastErrorMessage,
					cliCommandResult: undefined,
					exitCode: 1,
					signal: null,
				} ),
			} )
		);
		return [ emitter, {} ];
	} ) as unknown as ExecuteCliCommand;
}

describe( 'startSite', () => {
	it( 'explains the running-sites limit instead of the daemon error', async () => {
		const start = startSite(
			failingWith( 'Failed to start WordPress server: CAPACITY_LIMIT_REACHED: Cannot start site.' ),
			'/site'
		);

		await expect( start ).rejects.toBeInstanceOf( SiteStartRefusedError );
		await expect( start ).rejects.toThrow( 'The maximum number of running sites has been reached' );
	} );

	it( 'refuses a site WordPress is updating without running the command', async () => {
		const sitePath = mkdtempSync( path.join( os.tmpdir(), 'studio-maintenance-' ) );
		writeFileSync(
			path.join( sitePath, '.maintenance' ),
			`<?php $upgrading = ${ Math.floor( Date.now() / 1000 ) }; ?>`
		);
		const execute = vi.fn() as unknown as ExecuteCliCommand;

		await expect( startSite( execute, sitePath ) ).rejects.toBeInstanceOf( SiteStartRefusedError );
		expect( execute ).not.toHaveBeenCalled();
		rmSync( sitePath, { recursive: true, force: true } );
	} );

	it( "reports the command's own error otherwise", async () => {
		await expect( startSite( failingWith( 'Port in use' ), '/site' ) ).rejects.toThrow(
			/^Port in use$/
		);
	} );
} );
