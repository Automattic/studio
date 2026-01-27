import { app } from 'electron';
import { fork, ChildProcess, StdioOptions } from 'node:child_process';
import EventEmitter from 'node:events';
import * as Sentry from '@sentry/electron/main';
import { z } from 'zod';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';

export interface CliCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

type CliCommandEventMap< CapturesStdio extends boolean = false > = {
	started: void;
	error: { error: Error };
	data: { data: unknown };
	success: {
		result: CapturesStdio extends true ? CliCommandResult : undefined;
	};
	failure: {
		lastErrorMessage: string | undefined;
		result: CapturesStdio extends true ? CliCommandResult : undefined;
	};
};

// Schema to detect error messages from CLI IPC regardless of the specific action type
const cliErrorMessageSchema = z.object( {
	status: z.literal( 'fail' ),
	message: z.string(),
} );

class CliCommandEventEmitter< HasResult extends boolean = false > extends EventEmitter {
	on< K extends keyof CliCommandEventMap< HasResult > >(
		event: K,
		listener: ( payload: CliCommandEventMap< HasResult >[ K ] ) => void
	): this {
		return super.on( event, listener );
	}

	emit< K extends keyof CliCommandEventMap< HasResult > >(
		event: K,
		payload?: CliCommandEventMap< HasResult >[ K ]
	): boolean {
		return super.emit( event, payload );
	}
}

export interface ExecuteCliCommandOptions {
	/**
	 * Controls how stdout/stderr is handled:
	 * - 'ignore': ignore stdout/stderr completely
	 * - 'capture': capture stdout/stderr, available in success/failure events
	 */
	output: 'ignore' | 'capture';
	logPrefix?: string;
}

export function executeCliCommand(
	args: string[],
	options: { output: 'capture'; logPrefix?: string }
): [ CliCommandEventEmitter< true >, ChildProcess ];
export function executeCliCommand(
	args: string[],
	options: { output: 'ignore'; logPrefix?: string }
): [ CliCommandEventEmitter< false >, ChildProcess ];
export function executeCliCommand(
	args: string[],
	options?: ExecuteCliCommandOptions
): [ CliCommandEventEmitter< false >, ChildProcess ];
export function executeCliCommand(
	args: string[],
	options: ExecuteCliCommandOptions = { output: 'ignore' }
): [ CliCommandEventEmitter< boolean >, ChildProcess ] {
	const cliPath = getCliPath();

	let stdio: StdioOptions | undefined;
	if ( options.output === 'capture' ) {
		stdio = [ 'ignore', 'pipe', 'pipe', 'ipc' ];
	} else if ( options.output === 'ignore' ) {
		stdio = [ 'ignore', 'ignore', 'ignore', 'ipc' ];
	}

	const child = fork( cliPath, [ ...args, '--avoid-telemetry' ], {
		stdio,
		execPath: getBundledNodeBinaryPath(),
	} );
	const eventEmitter = new CliCommandEventEmitter< boolean >();

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
	let lastErrorMessage: string | undefined;

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

	child.on( 'message', ( message: unknown ) => {
		const errorParsed = cliErrorMessageSchema.safeParse( message );
		if ( errorParsed.success ) {
			lastErrorMessage = errorParsed.data.message;
		}

		eventEmitter.emit( 'data', { data: message } );
	} );

	let capturedExitCode: number | null = null;

	child.on( 'exit', ( code, signal ) => {
		capturedExitCode = code;
	} );

	function appQuitHandler() {
		const pid = child.pid;
		const result = child.kill();
		if ( result ) {
			console.log( `Successfully killed child process with pid ${ pid }` );
		} else {
			console.error(
				`Failed to kill child process with pid ${ pid }. This likely means the process is already terminated. CLI args:`,
				args
			);
		}
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
			eventEmitter.emit( 'failure', { lastErrorMessage, result } );
		}
	} );

	app.on( 'will-quit', appQuitHandler );

	return [ eventEmitter, child ];
}
