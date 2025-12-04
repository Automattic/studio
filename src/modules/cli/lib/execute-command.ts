import { fork, ChildProcess } from 'node:child_process';
import EventEmitter from 'node:events';
import * as Sentry from '@sentry/electron/main';
import { getCliPath } from 'src/storage/paths';

type CliCommandEventMap = {
	data: { data: unknown };
	error: { error: Error };
	success: void;
	failure: void;
};

export class CliCommandEventEmitter extends EventEmitter {
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

export interface ExecuteCliCommandOptions {
	silent?: boolean;
}

export function executeCliCommand(
	args: string[],
	options: ExecuteCliCommandOptions = {}
): [ CliCommandEventEmitter, ChildProcess ] {
	const cliPath = getCliPath();
	// Using Electron's utilityProcess.fork API gave us issues with the child process never exiting
	const child = fork( cliPath, [ ...args, '--avoid-telemetry' ], {
		stdio: options.silent ? [ 'ignore', 'ignore', 'ignore', 'ipc' ] : undefined,
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
		},
	} );
	const eventEmitter = new CliCommandEventEmitter();

	child.on( 'message', ( message: unknown ) => {
		eventEmitter.emit( 'data', { data: message } );
	} );

	child.on( 'error', ( error ) => {
		console.error( 'Child process error:', error );
		Sentry.captureException( error );
		eventEmitter.emit( 'error', { error } );
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

	return [ eventEmitter, child ];
}
