// DIAGNOSTIC (Windows quit hang): trace every CLI process into the daemon home's logs.
import fs from 'node:fs';
import path from 'node:path';
import { PROCESS_MANAGER_LOGS_DIR } from 'cli/lib/paths';

export function diag( message: string ) {
	try {
		fs.mkdirSync( PROCESS_MANAGER_LOGS_DIR, { recursive: true } );
		fs.appendFileSync(
			path.join( PROCESS_MANAGER_LOGS_DIR, 'cli-diag.log' ),
			`${ new Date().toISOString() } [cli ${ process.pid }] ${ message }\n`
		);
	} catch {
		// Diagnostic only.
	}
}

export function traceCliProcess() {
	diag( `argv ${ JSON.stringify( process.argv.slice( 2 ) ) } (ppid ${ process.ppid })` );
	process.on( 'exit', ( code ) => diag( `exit ${ code }` ) );
	process.on( 'disconnect', () => diag( 'ipc disconnected' ) );
	for ( const signal of [ 'SIGINT', 'SIGTERM', 'SIGBREAK' ] as const ) {
		process.on( signal, () => diag( `signal ${ signal }` ) );
	}
}
