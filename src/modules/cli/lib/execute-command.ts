import { utilityProcess } from 'electron';
import EventEmitter from 'node:events';
import path from 'node:path';
import { getResourcesPath } from 'src/storage/paths';

function* parseOutput( data: Buffer ): Generator< unknown, void, unknown > {
	const output = data.toString( 'utf8' );

	for ( const line of output.split( '\n' ) ) {
		if ( ! line.trim() ) {
			continue;
		}

		try {
			yield JSON.parse( line.trim() );
		} catch ( error ) {
			console.log( 'Parsing error', error, line );
		}
	}
}

export function executeCliCommand( args: string[] ) {
	const cliPath = path.join( getResourcesPath(), 'dist', 'cli', 'main.js' );
	const child = utilityProcess.fork( cliPath, [ ...args, '--output-format', 'json' ], {
		stdio: 'pipe',
	} );
	const eventEmitter = new EventEmitter();

	child.stdout?.on( 'data', ( data: Buffer ) => {
		for ( const parsed of parseOutput( data ) ) {
			eventEmitter.emit( 'data', parsed );
		}
	} );

	child.stderr?.on( 'data', ( data: Buffer ) => {
		console.log( 'stderr', data.toString( 'utf8' ) );
		for ( const parsed of parseOutput( data ) ) {
			eventEmitter.emit( 'error', parsed );
		}
	} );

	child.on( 'error', ( error ) => {
		console.error( 'Child process error:', error );
		eventEmitter.emit( 'error', error );
	} );

	child.on( 'exit', ( code: number | null ) => {
		console.log( 'Preview site creation completed with code', code );

		if ( code === 0 ) {
			eventEmitter.emit( 'success' );
		} else {
			eventEmitter.emit( 'error', { code, message: `Process exited with code ${ code }` } );
		}
	} );

	process.on( 'exit', () => {
		child.kill();
	} );

	return eventEmitter;
}
