import { fork, ChildProcess, StdioOptions } from 'node:child_process';
import EventEmitter from 'node:events';
import * as Sentry from '@sentry/electron/main';
import { getCliPath } from 'src/storage/paths';

export interface CliCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

type CliCommandEventMap = {
	data: { data: unknown };
	error: { error: Error };
	success: { result?: CliCommandResult };
	failure: { result?: CliCommandResult };
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

export interface ExecuteCliCommandOptions {
	/**
	 * Controls how stdout/stderr is handled:
	 * - undefined (default): inherit from parent (shows output in terminal)
	 * - 'ignore': ignore stdout/stderr completely
	 * - 'capture': capture stdout/stderr, available in success/failure events
	 */
	output: 'ignore' | 'capture';
}

export function executeCliCommand(
	args: string[],
	options: ExecuteCliCommandOptions = { output: 'ignore' }
): [ CliCommandEventEmitter, ChildProcess ] {
	const cliPath = getCliPath();

	let stdio: StdioOptions | undefined;
	if ( options.output === 'capture' ) {
		stdio = [ 'ignore', 'pipe', 'pipe', 'ipc' ];
	} else if ( options.output === 'ignore' ) {
		stdio = [ 'ignore', 'ignore', 'ignore', 'ipc' ];
	}

	// Using Electron's utilityProcess.fork API gave us issues with the child process never exiting
	const child = fork( cliPath, [ ...args, '--avoid-telemetry' ], {
		stdio,
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
		},
	} );
	const eventEmitter = new CliCommandEventEmitter();

	let stdout = '';
	let stderr = '';

	if ( options.output === 'capture' ) {
		child.stdout?.on( 'data', ( data: Buffer ) => {
			stdout += data.toString();
		} );
		child.stderr?.on( 'data', ( data: Buffer ) => {
			stderr += data.toString();
		} );
	}

	child.on( 'message', ( message: unknown ) => {
		eventEmitter.emit( 'data', { data: message } );
	} );

	child.on( 'error', ( error ) => {
		console.error( 'Child process error:', error );
		Sentry.captureException( error );
		eventEmitter.emit( 'error', { error } );
	} );

	let capturedExitCode: number | null = null;

	child.on( 'exit', ( code ) => {
		capturedExitCode = code;
	} );

	child.on( 'close', ( code ) => {
		child.removeAllListeners();

		const exitCode = capturedExitCode ?? code ?? 1;
		const result: CliCommandResult | undefined =
			options.output === 'capture' ? { stdout, stderr, exitCode } : undefined;

		if ( exitCode === 0 ) {
			eventEmitter.emit( 'success', { result } );
		} else {
			eventEmitter.emit( 'failure', { result } );
		}
	} );

	process.on( 'exit', () => {
		child.kill();
	} );

	return [ eventEmitter, child ];
}
