import { app } from 'electron';
import { fork, ChildProcess, StdioOptions } from 'node:child_process';
import EventEmitter from 'node:events';
import * as Sentry from '@sentry/electron/main';
import { z } from 'zod';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';

const activeChildren = new Set< ChildProcess >();

/**
 * Wait for all active CLI child processes to exit, then allow the app to quit.
 * Called from the will-quit handler in index.ts so Electron doesn't exit while
 * children are still writing to shared directories (e.g. copying skills files).
 */
export function waitForActiveCliChildren( timeout = 5_000 ): Promise< void > {
	if ( activeChildren.size === 0 ) {
		return Promise.resolve();
	}

	return new Promise< void >( ( resolve ) => {
		const timer = setTimeout( () => {
			for ( const child of activeChildren ) {
				child.kill();
			}
			resolve();
		}, timeout );

		let remaining = activeChildren.size;
		const onExit = () => {
			remaining--;
			if ( remaining === 0 ) {
				clearTimeout( timer );
				resolve();
			}
		};

		for ( const child of activeChildren ) {
			child.once( 'exit', onExit );
			child.kill();
		}
	} );
}

export type CliCommandResult = {
	stdout: string;
	stderr: string;
};

class CliCommandError extends Error {
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
		// The stack trace for this error is misleading, because it's not actually thrown where the error
		// happened - it's just a representation of an error that happened in a different process.
		this.stack = undefined;
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

type CliCommandEventMap< CapturesOutput extends boolean = false > = {
	started: void;
	error: { error: Error };
	data: { data: unknown };
	success: { result: CapturesOutput extends true ? CliCommandResult : undefined };
	failure: CapturesOutput extends true
		? { error: CliCommandError; result: CliCommandResult }
		: { error: CliCommandError };
};

// Schema to detect error messages from CLI IPC regardless of the specific action type
const cliErrorMessageSchema = z.object( {
	status: z.literal( 'fail' ),
	message: z.string(),
} );

class CliCommandEventEmitter< CapturesOutput extends boolean = false > extends EventEmitter {
	on< K extends keyof CliCommandEventMap< CapturesOutput > >(
		event: K,
		listener: ( payload: CliCommandEventMap< CapturesOutput >[ K ] ) => void
	): this {
		return super.on( event, listener );
	}

	emit< K extends keyof CliCommandEventMap< CapturesOutput > >(
		event: K,
		payload?: CliCommandEventMap< CapturesOutput >[ K ]
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
		execArgv: [ '--experimental-wasm-jspi' ],
		env: { ...process.env },
	} );
	activeChildren.add( child );
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
		activeChildren.delete( child );
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
			if ( options.output === 'capture' ) {
				eventEmitter.emit( 'failure', { error, result } );
			} else {
				eventEmitter.emit( 'failure', { error } );
			}
		}
	} );

	app.on( 'will-quit', appQuitHandler );

	return [ eventEmitter, child ];
}
