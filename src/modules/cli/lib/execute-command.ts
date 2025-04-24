import { fork } from 'node:child_process';
import EventEmitter from 'node:events';
import * as Sentry from '@sentry/electron/main';
import { getCliPath } from 'src/storage/paths';

type CliCommandEventMap = {
	data: { data: unknown };
	error: { error: unknown };
	'fatal-error': { error: Error };
	success: void;
	failure: void;
};

class CliCommandEventEmitter extends EventEmitter {
	on< K extends keyof CliCommandEventMap >(
		event: K,
		listener: ( payload: CliCommandEventMap[ K ] ) => void
	): this {
		return super.on( event, listener );
	}

	emit< K extends keyof CliCommandEventMap >(
		event: K,
		payload?: CliCommandEventMap[ K ]
	): boolean {
		return super.emit( event, payload );
	}
}

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

export function executeCliCommand( args: string[] ): CliCommandEventEmitter {
	const cliPath = getCliPath();
	// Using Electron's utilityProcess.fork API gave us issues with the child process never exiting
	const child = fork( cliPath, [ ...args, '--output-format', 'json', '--avoid-telemetry' ], {
		stdio: 'pipe',
	} );
	const eventEmitter = new CliCommandEventEmitter();

	child.stdout?.on( 'data', ( data: Buffer ) => {
		for ( const parsed of parseOutput( data ) ) {
			eventEmitter.emit( 'data', { data: parsed } );
		}
	} );

	child.stderr?.on( 'data', ( data: Buffer ) => {
		for ( const parsed of parseOutput( data ) ) {
			Sentry.captureException( parsed );
			eventEmitter.emit( 'error', { error: parsed } );
		}
	} );

	child.on( 'error', ( error ) => {
		console.error( 'Child process error:', error );
		Sentry.captureException( error );
		eventEmitter.emit( 'fatal-error', { error } );
	} );

	child.on( 'exit', ( code: number | null ) => {
		if ( code === 0 ) {
			eventEmitter.emit( 'success' );
		} else {
			eventEmitter.emit( 'failure' );
		}
	} );

	process.on( 'exit', () => {
		child.kill();
	} );

	return eventEmitter;
}
