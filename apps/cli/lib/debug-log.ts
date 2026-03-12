import { appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface DebugLogOptions {
	defaultFilename: string;
	enabledEnvVar: string;
	logFileEnvVar?: string;
	scope?: string;
}

export interface DebugLogEntry {
	event: string;
	payload?: unknown;
	scope?: string;
	timestamp: string;
}

export interface DebugLogger {
	enabled: boolean;
	log: ( event: string, payload?: unknown ) => void;
	path: string;
}

function isEnabled( value: string | undefined ): boolean {
	if ( ! value ) {
		return false;
	}

	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true';
}

export function createDebugLogger( options: DebugLogOptions ): DebugLogger {
	const enabled = isEnabled( process.env[ options.enabledEnvVar ] );
	const path =
		process.env[ options.logFileEnvVar ?? `${ options.enabledEnvVar }_FILE` ] ??
		join( tmpdir(), options.defaultFilename );

	return {
		enabled,
		path,
		log: ( event, payload ) => {
			if ( ! enabled ) {
				return;
			}

			const entry: DebugLogEntry = {
				timestamp: new Date().toISOString(),
				scope: options.scope,
				event,
				payload,
			};

			try {
				appendFileSync( path, JSON.stringify( entry ) + '\n' );
			} catch {
				return;
			}
		},
	};
}
