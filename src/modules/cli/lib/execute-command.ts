import { app } from 'electron';
import { fork, ChildProcess, StdioOptions } from 'node:child_process';
import EventEmitter from 'node:events';
import * as Sentry from '@sentry/electron/main';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';

export interface CliCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

type CliCommandEventMap = {
	started: void;
	error: { error: Error };
	data: { data: unknown };
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
	detached?: boolean;
	logPrefix?: string;
}

export function executeCliCommand(
	args: string[],
	options: ExecuteCliCommandOptions = { output: 'ignore', detached: false }
): [ CliCommandEventEmitter, ChildProcess ] {
	const cliPath = getCliPath();

	let stdio: StdioOptions | undefined;
	if ( options.output === 'capture' ) {
		stdio = [ 'ignore', 'pipe', 'pipe', 'ipc' ];
	} else if ( options.output === 'ignore' ) {
		stdio = [ 'ignore', 'ignore', 'ignore', 'ipc' ];
	}

	const child = fork( cliPath, [ ...args, '--avoid-telemetry' ], {
		stdio,
		detached: options.detached,
		execPath: getBundledNodeBinaryPath(),
	} );
	const eventEmitter = new CliCommandEventEmitter();

	child.on( 'spawn', () => {
		eventEmitter.emit( 'started' );
	} );

	child.on( 'error', ( error ) => {
		console.error( 'Child process error:', error );
		Sentry.captureException( error );
		eventEmitter.emit( 'error', { error } );
	} );

	let stdout = '';
	let stderr = '';

	if ( options.output === 'capture' ) {
		const logPrefix = options.logPrefix
			? `[CLI - pid ${ child.pid } - site ID ${ options.logPrefix }]`
			: '[CLI]';
		child.stdout?.on( 'data', ( data: Buffer ) => {
			const text = data.toString();
			stdout += text;
			const trimmed = text.trimEnd();
			if ( trimmed ) {
				console.log( `${ logPrefix } ${ trimmed }` );
			}
		} );
		child.stderr?.on( 'data', ( data: Buffer ) => {
			stderr += data.toString();
		} );
	}

	if ( ! options.detached ) {
		child.on( 'message', ( message: unknown ) => {
			eventEmitter.emit( 'data', { data: message } );
		} );
	}

	let capturedExitCode: number | null = null;

	child.on( 'exit', ( code ) => {
		capturedExitCode = code;
		// Destroy streams immediately on exit to allow 'close' event to fire on Windows
		child.stdout?.destroy();
		child.stderr?.destroy();
	} );

	function appQuitHandler() {
		const pid = child.pid;
		const result = child.kill();
		console.log( `Child process with pid ${ pid } killed with result: ${ result }` );
	}

	child.on( 'close', ( code ) => {
		child.removeAllListeners();
		app.off( 'will-quit', appQuitHandler );

		const exitCode = capturedExitCode ?? code ?? 1;
		const result: CliCommandResult | undefined =
			options.output === 'capture' ? { stdout, stderr, exitCode } : undefined;

		if ( exitCode === 0 ) {
			eventEmitter.emit( 'success', { result } );
		} else {
			eventEmitter.emit( 'failure', { result } );
		}
	} );

	if ( options.detached ) {
		child.unref();
	} else {
		app.on( 'will-quit', appQuitHandler );
	}

	return [ eventEmitter, child ];
}
