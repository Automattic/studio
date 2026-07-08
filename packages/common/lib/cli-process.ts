import { fork, spawnSync, type ChildProcess, type StdioOptions } from 'node:child_process';
import { z } from 'zod';
import { TypedEventEmitter } from '@studio/common/lib/typed-event-emitter';

/** Spawns the Studio CLI binary and relays its lifecycle as typed events. */

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
		// The stack trace for this error is misleading, because it's not actually
		// thrown where the error happened — it's just a representation of an error
		// that happened in a different process.
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

type CliCommandEventMap< CapturesOutput extends boolean > = {
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

type CliCommandEventEmitter< CapturesOutput extends boolean > = TypedEventEmitter<
	CliCommandEventMap< CapturesOutput >
>;

type ExecuteCliCommandOptionsIgnore = {
	output: 'ignore';
	env?: NodeJS.ProcessEnv;
};
type ExecuteCliCommandOptionsCapture = {
	output: 'capture';
	logPrefix?: string;
	env?: NodeJS.ProcessEnv;
};
type ExecuteCliCommandOptions = ExecuteCliCommandOptionsIgnore | ExecuteCliCommandOptionsCapture;

export interface CliRunnerConfig {
	// Absolute path to the CLI entry to fork (e.g. `.../cli/main.mjs`). The
	// desktop resolves the bundled CLI; the `studio ui` server passes its own
	// entry (`process.argv[1]`).
	cliBinary: string;
	// Node binary to fork with. Defaults to `process.execPath` (correct when the
	// host is itself a Node process, like the CLI). The desktop overrides this
	// with its bundled Node, since its own `execPath` is Electron.
	nodeBinary?: string;
	// Extra V8/Node flags for the child. The agent runs WordPress Playground, so
	// the default enables JSPI.
	execArgv?: string[];
	// Optional error sink (the desktop wires Sentry here).
	onError?: ( error: Error ) => void;
}

export type ExecuteCliCommand = CliRunner[ 'executeCliCommand' ];

export interface CliRunner {
	executeCliCommand(
		args: string[],
		options: { output: 'capture'; logPrefix?: string; env?: NodeJS.ProcessEnv }
	): [ CliCommandEventEmitter< true >, ChildProcess ];
	executeCliCommand(
		args: string[],
		options: { output: 'ignore'; logPrefix?: string; env?: NodeJS.ProcessEnv }
	): [ CliCommandEventEmitter< false >, ChildProcess ];
	executeCliCommand(
		args: string[],
		options?: ExecuteCliCommandOptions
	): [ CliCommandEventEmitter< false >, ChildProcess ];
	// Terminates every still-running child this runner spawned. The host calls
	// this once on shutdown (desktop: `app.on('will-quit')`; server: process
	// exit / SIGINT) so forked CLI processes don't outlive it.
	killAll(): void;
}

export function createCliRunner( config: CliRunnerConfig ): CliRunner {
	const { cliBinary, nodeBinary, execArgv = [ '--experimental-wasm-jspi' ], onError } = config;
	const liveChildren = new Set< ChildProcess >();

	// Only kills the child; its `close` handler still runs so awaiting callers
	// see a failure instead of hanging forever.
	function killChild( child: ChildProcess ): void {
		const pid = child.pid;

		// `child.kill()` only terminates the forked CLI process; on Windows its
		// php.exe descendants would orphan and keep their DLLs locked. `taskkill
		// /T` walks the whole tree instead.
		if ( process.platform === 'win32' && pid ) {
			spawnSync( 'taskkill', [ '/F', '/T', '/PID', String( pid ) ], {
				windowsHide: true,
				stdio: 'ignore',
			} );
			return;
		}

		child.kill();
	}

	function executeCliCommand(
		args: string[],
		options: ExecuteCliCommandOptions = { output: 'ignore' }
	): [ CliCommandEventEmitter< boolean >, ChildProcess ] {
		let stdio: StdioOptions | undefined;
		/**
		 * If there's an IPC channel, the CLI `Logger` uses IPC to communicate all
		 * expected events. This means that for many CLI commands, the captured
		 * stdout/stderr will be empty, unless something unexpected was logged.
		 */
		if ( options.output === 'capture' ) {
			stdio = [ 'ignore', 'pipe', 'pipe', 'ipc' ];
		} else if ( options.output === 'ignore' ) {
			stdio = [ 'ignore', 'ignore', 'ignore', 'ipc' ];
		}

		const child = fork( cliBinary, [ ...args, '--avoid-telemetry' ], {
			stdio,
			execPath: nodeBinary,
			execArgv,
			env: { ...process.env, ...options.env },
		} );
		liveChildren.add( child );
		const eventEmitter = new TypedEventEmitter< CliCommandEventMap< boolean > >();

		child.on( 'spawn', () => {
			eventEmitter.emit( 'started' );
		} );

		child.on( 'error', ( error ) => {
			console.error( 'Child process error:', error );
			onError?.( error );
			eventEmitter.emit( 'error', { error } );
		} );

		let stdout = '';
		let stderr = '';
		let lastErrorMessage: string | undefined;

		if ( options.output === 'capture' ) {
			// Only callers that opted-in with a `logPrefix` get stdout echoed to
			// the host console. Commands like `preview list --format json` dump
			// large structured payloads on stdout that would otherwise spam the
			// console every time snapshots are fetched.
			const logPrefix = options.logPrefix ? `[CLI - ${ options.logPrefix }]` : null;
			child.stdout?.on( 'data', ( data: Buffer ) => {
				const text = data.toString();
				stdout += text;
				if ( logPrefix ) {
					const trimmed = text.trimEnd();
					if ( trimmed ) {
						console.log( `${ logPrefix } ${ trimmed }` );
					}
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

		child.on( 'close', ( exitCode, signal ) => {
			child.removeAllListeners();
			liveChildren.delete( child );

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

		return [ eventEmitter, child ];
	}

	function killAll(): void {
		for ( const child of liveChildren ) {
			killChild( child );
		}
		liveChildren.clear();
	}

	return { executeCliCommand, killAll } as CliRunner;
}
