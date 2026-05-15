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

// CSI (`\x1b[...`), OSC (`\x1b]...BEL` or `...ST`), and other 7-bit C1 escapes.
const ANSI_ESCAPE_PATTERN =
	// eslint-disable-next-line no-control-regex
	/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_])/g;
// All C0 control chars except `\t` (0x09) and `\n` (0x0A), plus DEL (0x7F).
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B-\x1F\x7F]/g;

/**
 * Strip terminal control sequences from text destined for stdout. Telegram
 * messages and agent output are untrusted and may embed ANSI escapes (colors,
 * screen clears, cursor moves, OSC hyperlinks) that would otherwise manipulate
 * the user's terminal — a log-spoofing / phishing risk. We keep `\t` and `\n`
 * so multi-line replies still render with whitespace structure.
 */
export function stripTerminalControls( input: string ): string {
	return input.replace( ANSI_ESCAPE_PATTERN, '' ).replace( CONTROL_CHAR_PATTERN, '' );
}

/**
 * Apply both redaction and terminal-control sanitization. Use whenever text
 * (operator-supplied or attacker-supplied) is being written to stdout.
 */
function safeForStdout( input: string ): string {
	return stripTerminalControls( redact( input ) );
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
	const head = `[${ time }] ${ level } ${ safeForStdout( message ) }`;
	if ( ! meta ) {
		return `${ head }\n`;
	}
	// JSON.stringify already escapes control bytes inside string values
	// (e.g. `"[2J"`), but we sanitize again defensively in case the
	// shape ever changes. Redaction must run on the JSON so token fields
	// matching `"token":"…"` are caught after serialization.
	const safeMeta = safeForStdout( JSON.stringify( meta ) );
	return `${ head } ${ safeMeta }\n`;
}

interface PersistedLogLine {
	t?: unknown;
	level?: unknown;
	msg?: unknown;
	meta?: unknown;
	event?: unknown;
	content?: unknown;
}

function formatEventForStdout( time: string, kind: string, content: string ): string {
	const safe = safeForStdout( content ).replace( /\n/g, '\n  ' );
	const safeKind = stripTerminalControls( kind );
	return `[${ time }] ${ safeKind } ${ safe }\n`;
}

/**
 * Reformat one JSON log line (as written by RemoteSessionLogger) into the same
 * human-readable shape used when mirroring to stdout. Falls back to the raw
 * line (sanitized + newline-terminated) when parsing fails.
 */
export function formatLogLineForStdout( rawLine: string ): string {
	const trimmed = rawLine.replace( /\r?\n$/, '' );
	if ( trimmed.length === 0 ) {
		return '\n';
	}
	let parsed: PersistedLogLine;
	try {
		parsed = JSON.parse( trimmed ) as PersistedLogLine;
	} catch {
		return `${ stripTerminalControls( trimmed ) }\n`;
	}
	const time =
		typeof parsed.t === 'string' && parsed.t.length >= 19
			? parsed.t.slice( 11, 19 )
			: new Date().toTimeString().slice( 0, 8 );
	if ( typeof parsed.event === 'string' ) {
		const content = typeof parsed.content === 'string' ? parsed.content : '';
		return formatEventForStdout( time, parsed.event, content );
	}
	const level = isLogLevel( parsed.level ) ? parsed.level : 'info';
	const message = typeof parsed.msg === 'string' ? parsed.msg : '';
	const head = `[${ time }] ${ level } ${ safeForStdout( message ) }`;
	if ( parsed.meta && typeof parsed.meta === 'object' ) {
		const safeMeta = safeForStdout( JSON.stringify( parsed.meta ) );
		return `${ head } ${ safeMeta }\n`;
	}
	return `${ head }\n`;
}

function isLogLevel( value: unknown ): value is LogLevel {
	return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
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
	 * Write a single conversation-content line — incoming user text, progress
	 * messages, the final reply, paused questions. Persisted to the log file so
	 * `remote-session attach` can replay them; also mirrored to stdout in
	 * foreground mode for live viewing.
	 */
	event( kind: string, content: string ): void {
		ensureLogDir( this.logPath );
		rotateIfNeeded( this.logPath );

		const line =
			JSON.stringify( {
				t: new Date().toISOString(),
				event: kind,
				content: redact( content ),
			} ) + '\n';
		try {
			fs.appendFileSync( this.logPath, line, { encoding: 'utf8' } );
		} catch {
			// Logging is best-effort; never throw from here.
		}

		if ( ! this.mirrorToStdout ) {
			return;
		}
		const time = new Date().toTimeString().slice( 0, 8 );
		try {
			process.stdout.write( formatEventForStdout( time, kind, content ) );
		} catch {
			// Best-effort; never throw from here.
		}
	}
}
