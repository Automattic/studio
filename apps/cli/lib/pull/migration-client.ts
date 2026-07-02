/**
 * Runs reprint.phar with the PHP runtime selected by `STUDIO_RUNTIME`.
 *
 * reprint.phar is plain PHP, so any PHP runtime can execute it. The
 * `playground` runtime runs it inside a PHP WASM child process; the
 * `native-php` runtime spawns the bundled native `php` binary directly.
 * Either way the command is re-run while it exits with code 2 (partial)
 * until it exits with code 0 (success) or code 1 (error).
 */
import { ChildProcess, fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import {
	resolveNativePhpVersion,
	type NativePhpSupportedVersion,
} from '@studio/common/lib/php-binary-metadata';
import { SITE_RUNTIME_NATIVE_PHP, SiteRuntime } from '@studio/common/lib/site-runtime';
import { getReprintPharPath } from 'cli/lib/dependency-management/paths';
import { ensurePhpBinaryAvailable } from 'cli/lib/dependency-management/php-binary';
import { reapPhpTreeOnInterrupt, spawnPhpProcess } from 'cli/lib/native-php/php-process';

export interface ReprintProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/** Resolves the path to the bundled reprint.phar, throwing if it's missing. */
function getBundledReprintPhar(): string {
	const candidate = getReprintPharPath();
	if ( ! fs.existsSync( candidate ) ) {
		throw new Error( `Bundled reprint.phar not found at ${ candidate }` );
	}
	return candidate;
}

/**
 * Runs a reprint.phar command with the runtime selected by `STUDIO_RUNTIME`,
 * automatically retrying on partial completion.
 *
 * The `playground` runtime runs reprint inside a PHP WASM child process; the
 * `native-php` runtime spawns the bundled native `php` binary. Reprint
 * commands exit with code 2 when they've made progress but need another pass
 * (e.g., large file downloads that stream in chunks). This function loops
 * until the command exits with 0 (success) or throws on exit code 1 (error).
 */
export async function runReprintCommandUntilComplete(
	stateDir: string,
	fsRoot: string,
	args: string[],
	onProgress?: ( output: string ) => void,
	options: {
		mounts?: Array< { hostPath: string; vfsPath: string } >;
		progressLabel?: string;
		verboseCommands?: boolean;
		runtime?: SiteRuntime;
	} = {}
): Promise< ReprintProcessResult > {
	const pharPath = getBundledReprintPhar();
	const tmpDir = path.join( path.dirname( stateDir ), 'tmp' );
	fs.mkdirSync( tmpDir, { recursive: true } );

	// Log the exact reprint command so it can be copied and re-run for debugging.
	try {
		fs.appendFileSync(
			path.join( path.dirname( stateDir ), 'reprint-commands.log' ),
			`php reprint.phar ${ args.join( ' ' ) }\n`
		);
	} catch {
		// never block a pull on logging
	}

	// The native runtime spawns the bundled `php` binary, so make sure it's
	// downloaded before the first invocation. reprint.phar is PHP-version
	// agnostic, so any supported native version works.
	const runtime = options.runtime ?? SITE_RUNTIME_NATIVE_PHP;
	let nativePhpVersion: NativePhpSupportedVersion | undefined;
	if ( runtime === SITE_RUNTIME_NATIVE_PHP ) {
		nativePhpVersion = resolveNativePhpVersion( DEFAULT_PHP_VERSION );
		await ensurePhpBinaryAvailable( nativePhpVersion );
	}

	const label = options.progressLabel ?? args[ 0 ] ?? 'Working';
	const startTime = Date.now();

	const progress = createProgressReporter( label, startTime, onProgress );

	let lastResult: ReprintProcessResult | undefined;

	try {
		do {
			lastResult =
				runtime === SITE_RUNTIME_NATIVE_PHP
					? await runReprintCommandNative( pharPath, nativePhpVersion!, args, options, progress )
					: await runReprintCommandWasm(
							pharPath,
							stateDir,
							fsRoot,
							tmpDir,
							args,
							options,
							progress
					  );

			if ( lastResult.exitCode === 1 ) {
				const details = [ lastResult.stderr, lastResult.stdout ].filter( Boolean ).join( '\n' );
				throw new Error(
					details ||
						`reprint.phar exited with code 1 (command: ${
							args[ 0 ] ?? 'unknown'
						}). No output was captured.`
				);
			}
		} while ( lastResult.exitCode === 2 );

		return lastResult;
	} finally {
		progress.cleanup();
	}
}

/**
 * Forks a Node child process to execute a single reprint.phar invocation
 * inside PHP WASM.
 *
 * Communication with the child uses IPC messages: the child sends
 * `stdout`/`stderr` chunks for progress reporting and a final `result`
 * or `error` message. SIGINT is forwarded to the child so Ctrl-C
 * terminates cleanly.
 */
async function runReprintCommandWasm(
	pharPath: string,
	stateDir: string,
	fsRoot: string,
	tmpDir: string,
	args: string[],
	options: {
		mounts?: Array< { hostPath: string; vfsPath: string } >;
		verboseCommands?: boolean;
	},
	progress: ProgressReporter
): Promise< ReprintProcessResult > {
	const childPath = getReprintChildPath();

	if ( options.verboseCommands ) {
		const mountsSuffix =
			options.mounts && options.mounts.length > 0
				? ` mounts=${ options.mounts.map( ( m ) => `${ m.hostPath }:${ m.vfsPath }` ).join( ',' ) }`
				: '';
		console.error( `[reprint] php reprint.phar ${ args.join( ' ' ) }${ mountsSuffix }` );
	}

	return await new Promise< ReprintProcessResult >( ( resolve, reject ) => {
		const child: ChildProcess = fork( childPath, [], {
			stdio: [ 'pipe', 'pipe', 'pipe', 'ipc' ],
			env: { ...process.env },
		} );
		let settled = false;
		const childStderrChunks: string[] = [];

		const sigintHandler = () => {
			child.kill( 'SIGKILL' );
			process.exit( 130 );
		};

		const cleanup = () => {
			process.removeListener( 'SIGINT', sigintHandler );
		};

		child.stderr?.on( 'data', ( chunk: Buffer ) => {
			childStderrChunks.push( chunk.toString() );
		} );

		child.on(
			'message',
			( msg: {
				type: string;
				stdout?: string;
				stderr?: string;
				chunk?: string;
				exitCode?: number;
				message?: string;
			} ) => {
				if ( msg.type === 'stdout' ) {
					progress.pushStdoutChunk( msg.chunk || '' );
					return;
				}

				if ( msg.type === 'stderr' ) {
					return;
				}

				cleanup();
				settled = true;
				progress.flush();

				if ( msg.type === 'result' ) {
					resolve( {
						stdout: msg.stdout || '',
						stderr: msg.stderr || '',
						exitCode: msg.exitCode ?? 1,
					} );
					return;
				}

				if ( msg.type === 'error' ) {
					reject( new Error( msg.message || 'reprint child process error' ) );
				}
			}
		);

		child.on( 'error', ( err ) => {
			cleanup();
			if ( ! settled ) {
				settled = true;
				reject( err );
			}
		} );

		child.on( 'exit', ( code ) => {
			cleanup();
			if ( ! settled ) {
				settled = true;
				const childStderr = childStderrChunks.join( '' ).trim();
				const details = childStderr
					? `Child process stderr:\n${ childStderr }`
					: 'No error details available';
				reject( new Error( `reprint child process exited with code ${ code }. ${ details }` ) );
			}
		} );

		process.on( 'SIGINT', sigintHandler );

		child.send( {
			type: 'run',
			pharPath,
			stateDir,
			fsRoot,
			tmpDir,
			args,
			mounts: options.mounts ?? [],
		} );
	} );
}

/**
 * Executes a single reprint.phar invocation with the bundled native `php`
 * binary.
 *
 * Unlike the WASM path, native PHP has direct access to the host filesystem,
 * so the `--state-dir`, `--fs-root`, and mount paths reprint receives are real
 * paths it can read and write without any VFS mounting — the `mounts` option
 * is therefore unused here. The CA bundle, memory_limit, and proxy settings
 * come from the native `php.ini`/`process.env`, matching how Studio runs the
 * native site server.
 *
 * reprint emits thousands of JSON-L progress lines on stdout and can emit
 * megabytes of PHP warnings on stderr, so the child is spawned in `capture`
 * mode (neither stream is forwarded to this process's stdout/stderr). We feed
 * stdout into the shared progress reporter and keep only the last stdout line
 * (the result envelope) plus the stderr tail for diagnostics.
 */
async function runReprintCommandNative(
	pharPath: string,
	phpVersion: NativePhpSupportedVersion,
	args: string[],
	options: { verboseCommands?: boolean },
	progress: ProgressReporter
): Promise< ReprintProcessResult > {
	if ( options.verboseCommands ) {
		console.error(
			`[reprint] php reprint.phar ${ args.join( ' ' ) } (native-php ${ phpVersion })`
		);
	}

	return await new Promise< ReprintProcessResult >( ( resolve, reject ) => {
		const child = spawnPhpProcess( [ pharPath, ...args ], {
			phpVersion,
			mode: 'no-pipe',
		} );

		let settled = false;
		let lastStdoutLine = '';
		let stdoutRemainder = '';
		const STDERR_TAIL_BYTES = 256 * 1024;
		let stderrTail = '';

		const removeInterruptHandlers = reapPhpTreeOnInterrupt( child );

		const finish = ( fn: () => void ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			removeInterruptHandlers();
			progress.flush();
			fn();
		};

		child.stdout?.on( 'data', ( chunk: Buffer ) => {
			const text = chunk.toString();
			progress.pushStdoutChunk( text );

			const combined = stdoutRemainder + text;
			const lines = combined.split( '\n' );
			stdoutRemainder = lines.pop() ?? '';
			for ( let i = lines.length - 1; i >= 0; i-- ) {
				if ( lines[ i ].trim() ) {
					lastStdoutLine = lines[ i ];
					break;
				}
			}
		} );

		child.stderr?.on( 'data', ( chunk: Buffer ) => {
			stderrTail += chunk.toString();
			if ( stderrTail.length > STDERR_TAIL_BYTES ) {
				stderrTail = stderrTail.slice( stderrTail.length - STDERR_TAIL_BYTES );
			}
		} );

		child.once( 'error', ( err ) => finish( () => reject( err ) ) );

		child.once( 'close', ( code ) =>
			finish( () =>
				resolve( {
					stdout: stdoutRemainder.trim() || lastStdoutLine,
					stderr: stderrTail,
					exitCode: code ?? 1,
				} )
			)
		);
	} );
}

// reprint writes JSON-L to stdout: { phase, files_done, bytes_received, … }.
// The progress reporter splits the stream into lines, parses each into a
// snapshot, and formats a one-line spinner update like
// "Downloading files · 42/1337 files · 12.3 MB · 3m 12s".

interface ProgressSnapshot {
	phase?: string;
	message?: string;
	downloadedFiles?: number;
	totalFiles?: number;
	downloadedBytes?: number;
	totalBytes?: number;
	bytesReceived?: number;
	prevRequestBytes?: number;
	statementsExecuted?: number;
	statementsTotal?: number;
}

interface ProgressReporter {
	pushStdoutChunk: ( chunk: string ) => void;
	flush: () => void;
	cleanup: () => void;
}

/**
 * Creates a reporter that parses reprint's JSON-L stdout into human-readable
 * progress lines.
 *
 * Reprint emits one JSON object per line with fields like `phase`,
 * `files_done`, `bytes_received`, etc. The reporter accumulates these into
 * a snapshot and formats a spinner line such as
 * "Downloading files · 42/1337 files · 12.3 MB · 3m 12s". A 250ms interval
 * ticker re-renders the line to keep the elapsed time ticking even when no
 * new data arrives.
 */
function createProgressReporter(
	label: string,
	startTime: number,
	onProgress?: ( output: string ) => void
): ProgressReporter {
	let lineBuffer = '';
	let snapshot: ProgressSnapshot = {};

	const reportLines = ( lines: string[] ) => {
		if ( ! onProgress ) {
			return;
		}
		for ( const line of lines ) {
			const parsed = parseJsonl( line );
			if ( ! parsed ) {
				continue;
			}
			snapshot = updateSnapshot( parsed, snapshot );
			const msg = formatSnapshot( snapshot, label, elapsedSeconds() );
			if ( msg ) {
				onProgress( msg );
			}
		}
	};

	const elapsedSeconds = () => Math.floor( ( Date.now() - startTime ) / 1000 );

	const ticker =
		onProgress &&
		setInterval( () => {
			const msg = formatSnapshot( snapshot, label, elapsedSeconds() );
			if ( msg ) {
				onProgress( msg );
			}
		}, 250 );

	return {
		pushStdoutChunk( chunk: string ) {
			lineBuffer += chunk;
			const lines = lineBuffer.split( '\n' );
			lineBuffer = lines.pop() ?? '';
			reportLines( lines );
		},
		flush() {
			if ( lineBuffer.trim() ) {
				reportLines( [ lineBuffer.trim() ] );
			}
		},
		cleanup() {
			if ( ticker ) {
				clearInterval( ticker );
			}
		},
	};
}

/**
 * Parses a single JSON-L line from reprint's stdout, skipping non-progress
 * envelopes like HTTP response headers and protocol version handshakes.
 */
function parseJsonl( line: string ): Record< string, unknown > | null {
	try {
		const parsed = JSON.parse( line );
		if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
			return null;
		}
		// Skip result envelopes (preflight responses, protocol headers).
		if ( 'http_code' in parsed || 'protocol_version' in parsed ) {
			return null;
		}
		return parsed as Record< string, unknown >;
	} catch {
		return null;
	}
}

/**
 * Merges a parsed JSON-L record into the running progress snapshot.
 *
 * Reprint uses inconsistent field names across commands and versions
 * (e.g., `files_done` vs `downloaded_files` vs `files_indexed`), so this
 * function normalizes them into a single canonical snapshot shape.
 * Numeric counters only move forward (via Math.max) to avoid visual
 * regressions when reprint restarts a partial transfer.
 *
 * The `bytes_received` field is special: reprint resets it per HTTP request,
 * so this function detects resets and accumulates a running total across
 * requests.
 */
function updateSnapshot(
	record: Record< string, unknown >,
	prev: ProgressSnapshot
): ProgressSnapshot {
	const next: ProgressSnapshot = { ...prev };

	const phase = mapPhase( str( record.phase ) );
	if ( phase ) {
		next.phase = phase;
	}

	const type = str( record.type );
	if ( type === 'lifecycle' ) {
		next.phase = mapPhase( str( record.stage ) ) ?? next.phase;
		return next;
	}

	const downloadedFiles =
		num( record.files_done ) ??
		num( record.downloaded_files ) ??
		num( record.files_indexed ) ??
		num( record.index_size );
	const totalFiles = num( record.files_total ) ?? num( record.total_files );
	const downloadedBytes =
		num( record.downloaded_bytes ) ?? num( record.bytes_done ) ?? num( record.bytes_read );
	const totalBytes = num( record.total_bytes ) ?? num( record.bytes_total );
	const bytesReceived = num( record.bytes_received );
	const statementsExecuted = num( record.statements_executed );
	const statementsTotal = num( record.statements_total );

	if ( downloadedFiles !== undefined ) {
		next.downloadedFiles = Math.max( downloadedFiles, prev.downloadedFiles ?? 0 );
	}
	if ( totalFiles !== undefined ) {
		next.totalFiles = totalFiles;
	}
	if ( downloadedBytes !== undefined ) {
		next.downloadedBytes = Math.max( downloadedBytes, prev.downloadedBytes ?? 0 );
	}
	if ( totalBytes !== undefined ) {
		next.totalBytes = totalBytes;
	}
	if ( bytesReceived !== undefined ) {
		const prevReq = prev.prevRequestBytes ?? 0;
		const cumulative = prev.bytesReceived ?? 0;
		const restarted = bytesReceived < prevReq;
		next.prevRequestBytes = bytesReceived;
		next.bytesReceived = ( restarted ? cumulative : cumulative - prevReq ) + bytesReceived;
	}
	if ( statementsExecuted !== undefined ) {
		next.statementsExecuted = statementsExecuted;
	}
	if ( statementsTotal !== undefined ) {
		next.statementsTotal = statementsTotal;
	}

	const message = str( record.progress ) ?? str( record.message ) ?? str( record.event ) ?? type;
	if ( message && ! str( record.debug ) ) {
		next.message = message;
	}

	return next;
}

/**
 * Formats the current progress snapshot into a single-line status string
 * like "Downloading files · 42/1337 files · 12.3 MB · 3m 12s".
 *
 * Returns null when there's nothing meaningful to display (no counters,
 * no message, just the label).
 */
function formatSnapshot(
	snapshot: ProgressSnapshot,
	label: string,
	elapsed: number
): string | null {
	const displayLabel =
		snapshot.phase && snapshot.phase !== 'streaming' && snapshot.phase !== 'starting'
			? snapshot.phase.charAt( 0 ).toUpperCase() + snapshot.phase.slice( 1 )
			: label;

	const parts = [ displayLabel ];

	if ( snapshot.totalFiles !== undefined ) {
		parts.push( `${ snapshot.downloadedFiles ?? 0 }/${ snapshot.totalFiles } files` );
	}

	if ( snapshot.downloadedBytes !== undefined && snapshot.totalBytes !== undefined ) {
		parts.push( `${ fmtBytes( snapshot.downloadedBytes ) }/${ fmtBytes( snapshot.totalBytes ) }` );
	} else if ( snapshot.downloadedBytes !== undefined ) {
		parts.push( `${ fmtBytes( snapshot.downloadedBytes ) } downloaded` );
	} else if ( snapshot.bytesReceived !== undefined ) {
		parts.push( `${ fmtBytes( snapshot.bytesReceived ) } received` );
	}

	if ( snapshot.statementsExecuted !== undefined ) {
		if ( snapshot.statementsTotal !== undefined ) {
			parts.push( `${ snapshot.statementsExecuted }/${ snapshot.statementsTotal } statements` );
		} else {
			parts.push( `${ snapshot.statementsExecuted } statements` );
		}
	}

	if (
		snapshot.message &&
		snapshot.message !== snapshot.phase &&
		snapshot.totalFiles === undefined &&
		snapshot.statementsExecuted === undefined
	) {
		parts.push( snapshot.message );
	}

	if ( parts.length === 1 ) {
		return null;
	}

	const mins = Math.floor( elapsed / 60 );
	const secs = elapsed % 60;
	parts.push( mins > 0 ? `${ mins }m ${ secs }s` : `${ secs }s` );

	const line = parts.join( ' · ' );

	// picospinner clears previous output by counting how many terminal
	// lines the text occupied. It gets the terminal width once via
	// process.stdout.getWindowSize(), but some environments (e.g.
	// Conductor) don't provide it, leaving the width at Infinity.
	// When that happens, picospinner assumes 1 line regardless of
	// actual wrapping, so the clear only erases 1 line and each tick
	// leaves a ghost line behind. Cap the output to avoid wrapping.
	const maxWidth = ( process.stdout.getWindowSize?.()?.[ 0 ] ?? 80 ) - 4;
	if ( line.length > maxWidth ) {
		return line.slice( 0, maxWidth - 1 ) + '…';
	}
	return line;
}

/** Maps reprint's internal phase identifiers to user-facing labels. */
function mapPhase( phase: string | undefined ): string | undefined {
	switch ( phase ) {
		case 'index':
			return 'indexing remote files';
		case 'diff':
			return 'preparing download list';
		case 'fetch':
		case 'fetch-skipped':
			return 'streaming';
		case 'db-index':
			return 'indexing tables';
		case 'sql':
			return 'downloading';
		case 'db-apply':
			return 'applying';
		default:
			return phase;
	}
}

/** Coerces a value to a finite number, returning undefined for non-numeric or infinite values. */
function num( value: unknown ): number | undefined {
	if ( typeof value === 'number' ) {
		return Number.isFinite( value ) ? value : undefined;
	}
	if ( typeof value === 'string' && value.length > 0 ) {
		const n = Number( value );
		return Number.isFinite( n ) ? n : undefined;
	}
	return undefined;
}

/** Returns the value as a string if it's a non-empty string, undefined otherwise. */
function str( value: unknown ): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Formats a byte count as a human-readable string (B, KB, or MB). */
function fmtBytes( bytes: number ): string {
	if ( bytes < 1024 ) {
		return `${ bytes } B`;
	}
	if ( bytes < 1024 * 1024 ) {
		return `${ ( bytes / 1024 ).toFixed( 0 ) } KB`;
	}
	return `${ ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) } MB`;
}

/**
 * Resolves the path to the child process entry point that hosts PHP WASM.
 *
 * Checks for both `.mjs` and `.js` extensions to support different build
 * configurations. Falls back to `.mjs` if neither exists, letting the
 * runtime produce a clear "file not found" error.
 */
function getReprintChildPath(): string {
	for ( const filename of [ 'reprint-child.mjs', 'reprint-child.js' ] ) {
		const candidate = path.resolve( import.meta.dirname, filename );
		if ( fs.existsSync( candidate ) ) {
			return candidate;
		}
	}
	return path.resolve( import.meta.dirname, 'reprint-child.mjs' );
}
