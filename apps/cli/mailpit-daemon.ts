/**
 * WordPress Studio Mailpit Daemon
 *
 * Spawned by the process manager daemon to run the Mailpit server that catches
 * every site's email (see cli/lib/mailpit/server). Arguments: the ports file, the
 * HTTP and SMTP ports, the Mailpit binary, then the arguments to run it with.
 *
 * Writes the ports file and reports `ready` once Mailpit answers, and deletes the
 * file when it exits, so sites only send email to a Mailpit that is running.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import type { ChildMessageRaw } from 'cli/lib/types/wordpress-server-ipc';

const READY_TIMEOUT_MS = 10_000;

const [ portsPath, httpPort, smtpPort, binaryPath, ...args ] = process.argv.slice( 2 );
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
mailpit.on( 'exit', ( code ) => {
	console.error( `[Mailpit Daemon] Mailpit exited with code ${ String( code ) }` );
	process.exit( code || 1 );
} );

process.on( 'exit', () => {
	fs.rmSync( portsPath, { force: true } );
	mailpit.kill();
} );
// How the daemon stops a process on Windows, which has no SIGTERM.
process.on( 'disconnect', () => process.exit( 0 ) );
for ( const signal of [ 'SIGTERM', 'SIGINT' ] as const ) {
	process.on( signal, () => process.exit( 0 ) );
}

async function answers(): Promise< boolean > {
	try {
		const response = await fetch( `http://127.0.0.1:${ httpPort }/api/v1/info`, {
			signal: AbortSignal.timeout( 1_000 ),
		} );
		return response.ok;
	} catch {
		return false;
	}
}

async function reportReady() {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while ( ! ( await answers() ) ) {
		if ( Date.now() > deadline ) {
			console.error( `[Mailpit Daemon] Mailpit did not answer on port ${ httpPort }` );
			process.exit( 1 );
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 100 ) );
	}
	fs.writeFileSync(
		portsPath,
		JSON.stringify( { httpPort: Number( httpPort ), smtpPort: Number( smtpPort ) } )
	);
	process.send?.( { topic: 'ready' } );
}

void reportReady();
