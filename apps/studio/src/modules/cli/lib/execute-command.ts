import { app } from 'electron';
import { fork, spawnSync, type ChildProcess, type StdioOptions } from 'node:child_process';
import * as Sentry from '@sentry/electron/main';
import { z } from 'zod';
import { getPreferredUiVersion } from 'src/lib/studio-ui-mode';
import { TypedEventEmitter } from 'src/modules/cli/lib/typed-event-emitter';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';

// Origin tag passed to every app-spawned CLI process so its Tracks events are attributed to the
// active desktop renderer (v1 = legacy, v2 = agentic). Read by the CLI in `apps/cli/lib/tracks.ts`.
// Also used for agent runs, which fork the CLI through `packages/common/ai/run-manager.ts` rather
// than through this module.
export function getTracksOriginEnv(): string {
	return `studio-ui:${ getPreferredUiVersion() }`;
}

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

export function executeCliCommand(
	args: string[],
	options: { output: 'capture'; logPrefix?: string; env?: NodeJS.ProcessEnv }
): [ CliCommandEventEmitter< true >, ChildProcess ];
export function executeCliCommand(
	args: string[],
	options: { output: 'ignore'; logPrefix?: string; env?: NodeJS.ProcessEnv }
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
		env: { ...process.env, STUDIO_TRACKS_ORIGIN: getTracksOriginEnv(), ...options.env },
	} );
	const eventEmitter = new TypedEventEmitter< CliCommandEventMap< boolean > >();

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
		// Only callers that opted-in with a `logPrefix` get stdout echoed to
		// the main-process console. Commands like `preview list --format json`
		// dump large structured payloads on stdout that would otherwise spam
		// `npm start` output every time snapshots are fetched.
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

	// Only kills the child; the `close` handler still runs to settle the
	// emitter and detach this listener if a prevented quit keeps the app alive.
	function appQuitHandler() {
		const pid = child.pid;

		// `child.kill()` only terminates the forked CLI process; on Windows its php.exe descendants
		// would orphan and keep their DLLs locked. `taskkill /T` walks the whole tree instead.
		if ( process.platform === 'win32' && pid ) {
			spawnSync( 'taskkill', [ '/F', '/T', '/PID', String( pid ) ], {
				windowsHide: true,
				stdio: 'ignore',
			} );
			return;
		}

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
