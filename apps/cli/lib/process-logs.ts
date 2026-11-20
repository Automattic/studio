/**
 * How the process-manager daemon names a process's log files:
 * `<process>-{out,error}-<YYYYMMDD>.log`, after the day the process started.
 */
import fs from 'fs';
import path from 'path';
import { PROCESS_MANAGER_LOGS_DIR } from 'cli/lib/paths';

export interface ProcessLogPaths {
	stdoutLogPath: string;
	stderrLogPath: string;
}

function formatLogDateTag( date: Date ): string {
	const year = date.getFullYear();
	const month = String( date.getMonth() + 1 ).padStart( 2, '0' );
	const day = String( date.getDate() ).padStart( 2, '0' );
	return `${ year }${ month }${ day }`;
}

export function getProcessLogPaths(
	processName: string,
	date: Date = new Date()
): ProcessLogPaths {
	const dateTag = formatLogDateTag( date );
	return {
		stdoutLogPath: path.join( PROCESS_MANAGER_LOGS_DIR, `${ processName }-out-${ dateTag }.log` ),
		stderrLogPath: path.join( PROCESS_MANAGER_LOGS_DIR, `${ processName }-error-${ dateTag }.log` ),
	};
}

/**
 * The newest stdout and stderr log files of `processName`. The daemon keeps
 * writing to the files of the day a process started, so those are the current
 * ones. Falls back to today's names when there are none yet.
 */
export function findLatestProcessLogPaths( processName: string ): ProcessLogPaths {
	const outPrefix = `${ processName }-out-`;
	const errorPrefix = `${ processName }-error-`;
	let latestOut: string | undefined;
	let latestError: string | undefined;
	let entries: string[] = [];
	try {
		entries = fs.readdirSync( PROCESS_MANAGER_LOGS_DIR );
	} catch {
		// No logs directory yet.
	}
	const isDatedLog = ( entry: string, prefix: string ) =>
		entry.startsWith( prefix ) && /^\d{8}\.log$/.test( entry.slice( prefix.length ) );
	for ( const entry of entries ) {
		if ( isDatedLog( entry, outPrefix ) && ( ! latestOut || entry > latestOut ) ) {
			latestOut = entry;
		} else if ( isDatedLog( entry, errorPrefix ) && ( ! latestError || entry > latestError ) ) {
			latestError = entry;
		}
	}

	const today = getProcessLogPaths( processName );
	return {
		stdoutLogPath: latestOut
			? path.join( PROCESS_MANAGER_LOGS_DIR, latestOut )
			: today.stdoutLogPath,
		stderrLogPath: latestError
			? path.join( PROCESS_MANAGER_LOGS_DIR, latestError )
			: today.stderrLogPath,
	};
}
