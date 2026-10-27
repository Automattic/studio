/** Runs the bundled reprint.phar with Studio's native PHP binary. */
import fs from 'node:fs';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { resolveSupportedPhpVersion } from '@studio/common/lib/php-binary-metadata';
import { getReprintPharPath } from 'cli/lib/dependency-management/paths';
import { ensurePhpBinaryAvailable } from 'cli/lib/dependency-management/php-binary';
import { reapPhpTreeOnInterrupt, spawnPhpProcess } from 'cli/lib/native-php/php-process';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';

export interface ReprintProcessResult {
	/** The last stdout line other than the command report: the command's result. */
	stdout: string;
	stderr: string;
	exitCode: number;
	/** The `reprint_report` record Reprint appends when stdout is not a terminal. */
	report?: ReprintReport;
}

/**
 * The final record of every Reprint command. Commands add their own fields,
 * such as `public_key` for `keygen`.
 */
interface ReprintReport extends Record< string, unknown > {
	type: 'reprint_report';
	command: string;
	status: string;
	exit_code: number;
	error: string | null;
	error_code: string | null;
}

function parseReprintReport( line: string ): ReprintReport | undefined {
	if ( ! line.includes( '"reprint_report"' ) ) {
		return undefined;
	}
	try {
		const parsed = JSON.parse( line );
		return parsed && typeof parsed === 'object' && parsed.type === 'reprint_report'
			? ( parsed as ReprintReport )
			: undefined;
	} catch {
		return undefined;
	}
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
 * Runs a Reprint command to completion. Exit code 2 means the command made
 * progress and needs another run; exit code 1 throws.
 */
export async function runReprintCommandUntilComplete(
	args: string[],
	onProgress?: ( output: string ) => void,
	options: {
		progressLabel?: string;
		verboseCommands?: boolean;
	} = {}
): Promise< ReprintProcessResult > {
	const pharPath = getBundledReprintPhar();

	// reprint.phar runs on any supported PHP version.
	const phpVersion = resolveSupportedPhpVersion( DEFAULT_PHP_VERSION );
	await ensurePhpBinaryAvailable( phpVersion );

	const label = options.progressLabel ?? args[ 0 ] ?? 'Working';
	const startTime = Date.now();

	const progress = createProgressReporter( label, startTime, onProgress );

	let lastResult: ReprintProcessResult | undefined;

	try {
		do {
			lastResult = await runReprintCommandNative( pharPath, phpVersion, args, options, progress );

			// 0 is done and 2 is partial progress; anything else is a failure.
			if ( lastResult.exitCode !== 0 && lastResult.exitCode !== 2 ) {
				const report = lastResult.report;
				const reportError = report?.error
					? [ report.error_code, report.error ].filter( Boolean ).join( ': ' )
					: '';
				const details = [ reportError, lastResult.stderr, lastResult.stdout ]
					.filter( Boolean )
					.join( '\n' );
				throw new Error(
					details ||
						`reprint.phar exited with code ${ lastResult.exitCode } (command: ${
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
 * Runs reprint.phar once. Output is captured rather than forwarded, since
 * Reprint prints thousands of progress lines and can print megabytes of PHP
 * warnings; only the result, the report and the end of stderr are kept.
 */
async function runReprintCommandNative(
	pharPath: string,
	phpVersion: SupportedPHPVersion,
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
		let report: ReprintReport | undefined;
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

		const takeStdoutLine = ( line: string ) => {
			if ( ! line.trim() ) {
				return;
			}
			const parsedReport = parseReprintReport( line );
			if ( parsedReport ) {
				report = parsedReport;
			} else {
				lastStdoutLine = line;
			}
		};

		child.stdout?.on( 'data', ( chunk: Buffer ) => {
			const text = chunk.toString();
			progress.pushStdoutChunk( text );

			const lines = ( stdoutRemainder + text ).split( '\n' );
			stdoutRemainder = lines.pop() ?? '';
			lines.forEach( takeStdoutLine );
		} );

		child.stderr?.on( 'data', ( chunk: Buffer ) => {
			stderrTail += chunk.toString();
			if ( stderrTail.length > STDERR_TAIL_BYTES ) {
				stderrTail = stderrTail.slice( stderrTail.length - STDERR_TAIL_BYTES );
			}
		} );

		child.once( 'error', ( err ) => finish( () => reject( err ) ) );

		child.once( 'close', ( code ) =>
			finish( () => {
				takeStdoutLine( stdoutRemainder );
				resolve( {
					stdout: lastStdoutLine,
					stderr: stderrTail,
					exitCode: code ?? 1,
					report,
				} );
			} )
		);
	} );
}

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
 * Turns Reprint's JSON lines into a progress line such as
 * "Downloading files · 42/1337 files · 12.3 MB · 3m 12s", redrawn every
 * 250ms so the elapsed time keeps moving.
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

/** Parses a progress line from Reprint's stdout, or returns null for anything else. */
function parseJsonl( line: string ): Record< string, unknown > | null {
	try {
		const parsed = JSON.parse( line );
		if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
			return null;
		}
		if (
			'http_code' in parsed ||
			'protocol_version' in parsed ||
			parsed.type === 'reprint_report'
		) {
			return null;
		}
		return parsed as Record< string, unknown >;
	} catch {
		return null;
	}
}

/**
 * Merges a progress record into the snapshot. Reprint's commands name the
 * same counters differently, and counters never go backwards when a transfer
 * restarts. `bytes_received` resets with every request, so it is summed.
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

/** Formats the snapshot as one line, or returns null when it has nothing to show. */
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

	// picospinner clears only one line when it can't read the terminal width
	// (e.g. in Conductor), so a wrapped line leaves copies behind.
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

/** The value as a finite number, if it is one. */
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

/** The value, if it is a non-empty string. */
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
