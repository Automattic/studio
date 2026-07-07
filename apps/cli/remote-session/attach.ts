import fs from 'fs';
import {
	getRemoteSessionLogPath,
	getRemoteSessionPidPath,
} from '@studio/common/lib/well-known-paths';
import { getDaemonStatus } from 'cli/remote-session/daemon';
import { formatLogLineForStdout } from 'cli/remote-session/logger';

const POLL_INTERVAL_MS = 250;
const DAEMON_LIVENESS_INTERVAL_MS = 1000;
/** Bytes of log history to replay on attach (tail-style). */
const INITIAL_TAIL_BYTES = 16 * 1024;

export class DaemonNotRunningError extends Error {
	constructor() {
		super( 'Remote-session daemon is not running.' );
		this.name = 'DaemonNotRunningError';
	}
}

export interface AttachOptions {
	pidFile?: string;
	logFile?: string;
	out?: NodeJS.WritableStream;
	signal?: AbortSignal;
	pollIntervalMs?: number;
	livenessIntervalMs?: number;
	initialTailBytes?: number;
}

interface ReaderState {
	offset: number;
	carry: string;
}

function readNew( logFile: string, state: ReaderState ): string[] {
	let stat: fs.Stats;
	try {
		stat = fs.statSync( logFile );
	} catch {
		return [];
	}
	const size = stat.size;
	if ( size === state.offset ) {
		return [];
	}
	if ( size < state.offset ) {
		// File rotated or truncated.
		state.offset = 0;
		state.carry = '';
	}
	const fd = fs.openSync( logFile, 'r' );
	try {
		const length = size - state.offset;
		const buf = Buffer.alloc( length );
		fs.readSync( fd, buf, 0, length, state.offset );
		state.offset = size;
		const text = state.carry + buf.toString( 'utf8' );
		const lastNl = text.lastIndexOf( '\n' );
		if ( lastNl === -1 ) {
			state.carry = text;
			return [];
		}
		state.carry = text.slice( lastNl + 1 );
		return text
			.slice( 0, lastNl )
			.split( '\n' )
			.filter( ( line ) => line.length > 0 );
	} finally {
		fs.closeSync( fd );
	}
}

function seekTail( logFile: string, tailBytes: number ): ReaderState {
	let stat: fs.Stats;
	try {
		stat = fs.statSync( logFile );
	} catch {
		return { offset: 0, carry: '' };
	}
	if ( stat.size <= tailBytes ) {
		return { offset: 0, carry: '' };
	}
	// Skip past the first partial line so we don't print a truncated entry.
	const fd = fs.openSync( logFile, 'r' );
	try {
		const start = stat.size - tailBytes;
		const buf = Buffer.alloc( tailBytes );
		fs.readSync( fd, buf, 0, tailBytes, start );
		const firstNl = buf.indexOf( 0x0a );
		const safeStart = firstNl === -1 ? stat.size : start + firstNl + 1;
		return { offset: safeStart, carry: '' };
	} finally {
		fs.closeSync( fd );
	}
}

function isProcessAlive( pid: number ): boolean {
	try {
		process.kill( pid, 0 );
		return true;
	} catch ( error ) {
		const code = ( error as NodeJS.ErrnoException ).code;
		return code === 'EPERM';
	}
}

/**
 * Attach to a running remote-session daemon by streaming its log file to stdout.
 * Returns when the abort signal fires (Ctrl-C) or when the daemon process exits.
 * Does not stop the daemon — detaching the terminal is the only side effect.
 */
export async function runAttach( options: AttachOptions = {} ): Promise< void > {
	const pidFile = options.pidFile ?? getRemoteSessionPidPath();
	const logFile = options.logFile ?? getRemoteSessionLogPath();
	const out = options.out ?? process.stdout;
	const pollMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
	const livenessMs = options.livenessIntervalMs ?? DAEMON_LIVENESS_INTERVAL_MS;
	const tailBytes = options.initialTailBytes ?? INITIAL_TAIL_BYTES;

	const status = getDaemonStatus( pidFile );
	if ( ! status.running || status.pid === undefined ) {
		throw new DaemonNotRunningError();
	}
	const daemonPid = status.pid;

	out.write( `Attached to remote-session daemon (PID ${ daemonPid }).\n` );
	out.write( `Log: ${ logFile }\n` );
	out.write( 'Press Ctrl-C to detach (daemon keeps running).\n' );

	const state = seekTail( logFile, tailBytes );
	// Drain whatever is already past the tail anchor before entering the loop.
	for ( const line of readNew( logFile, state ) ) {
		out.write( formatLogLineForStdout( line ) );
	}

	let lastLiveness = Date.now();
	while ( true ) {
		if ( options.signal?.aborted ) {
			return;
		}
		await sleepAbortable( pollMs, options.signal );
		if ( options.signal?.aborted ) {
			return;
		}
		for ( const line of readNew( logFile, state ) ) {
			out.write( formatLogLineForStdout( line ) );
		}
		const now = Date.now();
		if ( now - lastLiveness >= livenessMs ) {
			lastLiveness = now;
			if ( ! isProcessAlive( daemonPid ) ) {
				// Final drain before reporting exit.
				for ( const line of readNew( logFile, state ) ) {
					out.write( formatLogLineForStdout( line ) );
				}
				out.write( `Remote-session daemon (PID ${ daemonPid }) exited.\n` );
				return;
			}
		}
	}
}

function sleepAbortable( ms: number, signal?: AbortSignal ): Promise< void > {
	return new Promise( ( resolve ) => {
		if ( signal?.aborted ) {
			resolve();
			return;
		}
		const timer = setTimeout( () => {
			signal?.removeEventListener( 'abort', onAbort );
			resolve();
		}, ms );
		const onAbort = () => {
			clearTimeout( timer );
			resolve();
		};
		signal?.addEventListener( 'abort', onAbort, { once: true } );
	} );
}
