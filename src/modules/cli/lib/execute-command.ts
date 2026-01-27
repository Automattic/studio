import { app } from 'electron';
import { fork, ChildProcess, StdioOptions } from 'node:child_process';
import EventEmitter from 'node:events';
import * as Sentry from '@sentry/electron/main';
import { z } from 'zod';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';

export type CliCommandResult = {
	stdout: string;
	stderr: string;
};

export class CliCommandError extends Error {
	baseMessage = 'CLI command failed';
	readonly lastErrorMessage: string | undefined;
	readonly cliCommandResult: CliCommandResult | undefined;
	readonly exitCode: number | null;
	readonly signal: NodeJS.Signals | null;

	constructor( options: {
		lastErrorMessage: string | undefined;
		cliCommandResult: CliCommandResult | undefined;
		exitCode: number | null;
		signal: NodeJS.Signals | null;
	} ) {
		super();
		this.lastErrorMessage = options.lastErrorMessage;
		this.cliCommandResult = options.cliCommandResult;
		this.exitCode = options.exitCode;
		this.signal = options.signal;
		this.name = 'CliCommandError';
	}

	get message(): string {
		const messageParts: string[] = [];

		if ( this.lastErrorMessage ) {
			messageParts.push( `[Last error message] ${ this.lastErrorMessage }` );
		}

		if ( this.baseMessage ) {
			messageParts.push( `[Base message] ${ this.baseMessage }` );
		}

		if ( this.cliCommandResult ) {
			const stderr = this.cliCommandResult.stderr.trim();
			const stdout = this.cliCommandResult.stdout.trim();
			if ( stderr ) {
				messageParts.push( `[stderr] ${ stderr }` );
			} else if ( stdout ) {
				messageParts.push( `[stdout] ${ stdout }` );
			}
		}

		if ( this.signal !== null ) {
			messageParts.push( `[Terminated by signal] ${ this.signal }` );
		} else if ( this.exitCode !== null ) {
			messageParts.push( `[Exit code] ${ this.exitCode }` );
		}

		return messageParts
			.map( ( part, index ) => ( index === 0 ? part : `  ${ part }` ) )
			.join( '\n' );
	}
}

type CliCommandEventMap = {
	started: void;
	error: { error: Error };
	data: { data: unknown };
	success: { result: CliCommandResult | undefined };
	failure: { error: CliCommandError };
};

// Schema to detect error messages from CLI IPC regardless of the specific action type
const cliErrorMessageSchema = z.object( {
	status: z.literal( 'fail' ),
	message: z.string(),
} );

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

type ExecuteCliCommandOptionsIgnore = {
	output: 'ignore';
};
type ExecuteCliCommandOptionsCapture = {
	output: 'capture';
	logPrefix?: string;
};
type ExecuteCliCommandOptions = ExecuteCliCommandOptionsIgnore | ExecuteCliCommandOptionsCapture;

export function executeCliCommand(
	args: string[],
	options: ExecuteCliCommandOptions = { output: 'ignore' }
): [ CliCommandEventEmitter, ChildProcess ] {
	const cliPath = getCliPath();

	let stdio: StdioOptions | undefined;
	/**
	 * If there's an IPC channel, the CLI `Logger` uses IPC to communicate all expected events. This
	 * means that for many CLI commands, the captured stdout/stderr will be empty, unless something
	 * unexpected was logged.
	 */
	if ( options.output === 'capture' ) {
		stdio = [ 'ignore', 'pipe', 'pipe', 'ipc' ];
	} else if ( options.output === 'ignore' ) {
		stdio = [ 'ignore', 'ignore', 'ignore', 'ipc' ];
	}

	const child = fork( cliPath, [ ...args, '--avoid-telemetry' ], {
		stdio,
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
	let lastErrorMessage: string | undefined;

	if ( options.output === 'capture' ) {
		const logPrefix = options.logPrefix ? `[CLI - site ID ${ options.logPrefix }]` : '[CLI]';
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

	function appQuitHandler() {
		const pid = child.pid;
		child.removeAllListeners();
		const result = child.kill();
		if ( result ) {
			console.log( `Successfully killed child process with pid ${ pid }. Args:`, args );
		} else {
			console.error(
				`Failed to kill child process with pid ${ pid }. This likely means the process is already terminated. CLI args:`,
				args
			);
		}
	}

	child.on( 'close', ( exitCode, signal ) => {
		child.removeAllListeners();
		app.off( 'will-quit', appQuitHandler );

		let result: CliCommandResult | undefined;

		if ( options.output === 'capture' ) {
			result = { stdout, stderr };
		}

		if ( exitCode === 0 ) {
			eventEmitter.emit( 'success', { result } );
		} else {
			const error = new CliCommandError( {
				lastErrorMessage,
				cliCommandResult: result,
				exitCode,
				signal,
			} );
			eventEmitter.emit( 'failure', { error } );
		}
	} );

	app.on( 'will-quit', appQuitHandler );

	return [ eventEmitter, child ];
}
