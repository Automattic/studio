import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { CliCommandError, type ExecuteCliCommand } from '@studio/common/lib/cli-process';
import { SiteCapacityError, startSite } from '@studio/common/sites/lifecycle';

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

		await expect( start ).rejects.toBeInstanceOf( SiteCapacityError );
		await expect( start ).rejects.toThrow( 'The maximum number of running sites has been reached' );
	} );

	it( "reports the command's own error otherwise", async () => {
		await expect( startSite( failingWith( 'Port in use' ), '/site' ) ).rejects.toThrow(
			/^Port in use$/
		);
	} );
} );
