import { killChild } from '@studio/common/lib/cli-process';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import type { RemoteConnectionRequest } from '@studio/common/lib/remote-connection';
import type { RemoteChild } from 'src/modules/phone-access/lib/phone-access';

// Runs the bundled CLI's `studio remote` on `port` over `connection`, as the
// app runs its other CLI commands. `STUDIO_REMOTE_HOST` picks a local network
// address instead, as `--host` does: checks set it to loopback so they never
// open a port on the network.
export function startRemote( port: number, connection: RemoteConnectionRequest ): RemoteChild {
	const host = process.env.STUDIO_REMOTE_HOST;
	const [ events, child ] = executeCliCommand(
		[
			'remote',
			'--port',
			String( port ),
			...( host ? [ '--host', host ] : [ '--connection', connection ] ),
		],
		{ output: 'ignore' }
	);
	let listener: ( ( errorMessage?: string ) => void ) | undefined;
	let ended: { message?: string } | undefined;
	const end = ( message?: string ) => {
		if ( ended ) {
			return;
		}
		ended = { message };
		listener?.( message );
	};
	events.on( 'success', () => end() );
	events.on( 'failure', ( { error } ) => end( error.lastErrorMessage ) );
	events.on( 'error', ( { error } ) => end( error.message ) );

	return {
		pid: child.pid,
		onExit: ( callback ) => {
			listener = callback;
			if ( ended ) {
				callback( ended.message );
			}
		},
		// `studio remote` drops its pairing codes and its record on SIGTERM;
		// one that does not end within 2 s is killed.
		stop: () => killChild( child ),
	};
}

export function isProcessAlive( pid: number ): boolean {
	try {
		process.kill( pid, 0 );
		return true;
	} catch {
		return false;
	}
}
