/**
 * WordPress Studio Mailpit Daemon
 *
 * Spawned by the process manager daemon to run the Mailpit server that catches
 * every site's email (see cli/lib/mailpit/server). Arguments: the Mailpit binary,
 * then the arguments to run it with. Exits when Mailpit does, and takes Mailpit
 * down with it however it is stopped.
 */
import { spawn } from 'child_process';
import type { ChildMessageRaw } from 'cli/lib/types/wordpress-server-ipc';

const [ binaryPath, ...args ] = process.argv.slice( 2 );
const mailpit = spawn( binaryPath, args, {
	stdio: [ 'ignore', 'inherit', 'inherit' ],
	windowsHide: true,
} );

if ( mailpit.pid !== undefined ) {
	// Lets the daemon stop Mailpit directly too: on Windows, stopping this wrapper
	// does not stop the processes it started.
	const message: ChildMessageRaw = { topic: 'server-process-started', data: { pid: mailpit.pid } };
	process.send?.( message );
}

mailpit.on( 'error', ( error ) => {
	console.error( '[Mailpit Daemon] Failed to start Mailpit:', error );
	process.exit( 1 );
} );
mailpit.on( 'exit', ( code ) => process.exit( code ?? 1 ) );

const stopMailpit = () => mailpit.kill();
process.on( 'exit', stopMailpit );
// How the daemon stops a process on Windows, which has no SIGTERM.
process.on( 'disconnect', () => process.exit( 0 ) );
for ( const signal of [ 'SIGTERM', 'SIGINT' ] as const ) {
	process.on( signal, () => process.exit( 0 ) );
}
