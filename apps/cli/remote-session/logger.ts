import fs from 'fs';
import path from 'path';
import { getRemoteSessionLogPath } from '@studio/common/lib/well-known-paths';

const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_ROTATIONS = 3;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._\-+/=]+/g;
const TOKEN_FIELD_PATTERN = /"token"\s*:\s*"[^"]*"/g;

/**
 * Redact obvious token-bearing strings before they reach the log file or stderr.
 * Conservative: we redact `Bearer …` and `"token": "…"` substrings — the known shapes
 * the controller handles. Any other secret source should be filtered at the call site.
 */
export function redact( input: string ): string {
	return input
		.replace( BEARER_PATTERN, 'Bearer [redacted]' )
		.replace( TOKEN_FIELD_PATTERN, '"token":"[redacted]"' );
}

function shouldLogDebug(): boolean {
	return process.env.STUDIO_REMOTE_DEBUG === '1';
}

function rotateIfNeeded( logPath: string ): void {
	let size: number;
	try {
		size = fs.statSync( logPath ).size;
	} catch {
		return;
	}
	if ( size < MAX_LOG_SIZE_BYTES ) {
		return;
	}
	// Rotate: remote-session.log.{N-1} -> .log.N, …, .log -> .log.1
	const oldest = `${ logPath }.${ MAX_LOG_ROTATIONS }`;
	try {
		fs.rmSync( oldest, { force: true } );
	} catch {
		// ignore
	}
	for ( let i = MAX_LOG_ROTATIONS - 1; i >= 1; i-- ) {
		const src = `${ logPath }.${ i }`;
		const dst = `${ logPath }.${ i + 1 }`;
		try {
			if ( fs.existsSync( src ) ) {
				fs.renameSync( src, dst );
			}
		} catch {
			// ignore
		}
	}
	try {
		fs.renameSync( logPath, `${ logPath }.1` );
	} catch {
		// ignore
	}
}

function ensureLogDir( logPath: string ): void {
	try {
		fs.mkdirSync( path.dirname( logPath ), { recursive: true } );
	} catch {
		// ignore
	}
}

export interface RemoteSessionLoggerOptions {
	/** Override the file path. Defaults to `~/.studio/remote-session.log`. */
	logPath?: string;
	/**
	 * Also write a human-readable line to stdout for each non-suppressed call.
	 * Used by `studio code --remote-session` so the user can watch session
	 * activity in the terminal while the interactive REPL is blocked.
	 */
	mirrorToStdout?: boolean;
}

function formatStdoutLine(
	level: LogLevel,
	message: string,
	meta?: Record< string, unknown >
): string {
	const time = new Date().toTimeString().slice( 0, 8 );
	const head = `[${ time }] ${ level } ${ redact( message ) }`;
	if ( ! meta ) {
		return `${ head }\n`;
	}
	const redactedMeta = redact( JSON.stringify( meta ) );
	return `${ head } ${ redactedMeta }\n`;
}

export class RemoteSessionLogger {
	private logPath: string;
	private mirrorToStdout: boolean;

	constructor( options: RemoteSessionLoggerOptions = {} ) {
		this.logPath = options.logPath ?? getRemoteSessionLogPath();
		this.mirrorToStdout = options.mirrorToStdout ?? false;
	}

	private write( level: LogLevel, message: string, meta?: Record< string, unknown > ): void {
		if ( level === 'debug' && ! shouldLogDebug() ) {
			return;
		}
		ensureLogDir( this.logPath );
		rotateIfNeeded( this.logPath );

		const line =
			JSON.stringify( {
				t: new Date().toISOString(),
				level,
				msg: redact( message ),
				...( meta ? { meta: JSON.parse( redact( JSON.stringify( meta ) ) ) } : {} ),
			} ) + '\n';
		try {
			fs.appendFileSync( this.logPath, line, { encoding: 'utf8' } );
		} catch {
			// Logging is best-effort; never throw from here.
		}

		if ( this.mirrorToStdout ) {
			try {
				process.stdout.write( formatStdoutLine( level, message, meta ) );
			} catch {
				// Stdout mirroring is best-effort; never throw from here.
			}
		}
	}

	debug( message: string, meta?: Record< string, unknown > ): void {
		this.write( 'debug', message, meta );
	}

	info( message: string, meta?: Record< string, unknown > ): void {
		this.write( 'info', message, meta );
	}

	warn( message: string, meta?: Record< string, unknown > ): void {
		this.write( 'warn', message, meta );
	}

	error( message: string, meta?: Record< string, unknown > ): void {
		this.write( 'error', message, meta );
	}

	/**
	 * Write a single conversation-content line to stdout only (never the file).
	 * Used to surface the actual subprocess event payloads — incoming user text,
	 * progress messages, the final reply, paused questions — while attached.
	 * Skipped when `mirrorToStdout` is off, so callers can sprinkle these freely
	 * without affecting non-streaming runs.
	 */
	event( kind: string, content: string ): void {
		if ( ! this.mirrorToStdout ) {
			return;
		}
		const time = new Date().toTimeString().slice( 0, 8 );
		const oneLine = redact( content ).replace( /\r?\n/g, '\n  ' );
		try {
			process.stdout.write( `[${ time }] ${ kind } ${ oneLine }\n` );
		} catch {
			// Best-effort; never throw from here.
		}
	}
}
