import { app } from 'electron';
import path from 'path';
import * as FileStreamRotator from 'file-stream-rotator';

let logStream: ReturnType< typeof FileStreamRotator.getStream > | null = null;

// Intentional typo of 'erro' so all levels the same number of characters
export type LogLevel = 'info' | 'warn' | 'erro';

export function setupLogging( {
	isForkedProcess = false,
	processId = 'main',
	// During development logs will be written to ~/Library/Logs/Electron/*.log because technically
	// the app is still called Electron from the system's point of view (see `CFBundleDisplayName`)
	// In the release build logs will be written to ~/Library/Logs/Studio/*.log
	logDir = app.getPath( 'logs' ),
}: {
	isForkedProcess?: boolean;
	processId?: string;
	logDir?: string;
} = {} ) {
	if ( ! isForkedProcess ) {
		// Set the logging path to the default for the platform.
		app.setAppLogsPath();
	}

	logStream = FileStreamRotator.getStream( {
		filename: path.join( logDir, 'studio-%DATE%' ),
		date_format: 'YYYYMMDD',
		frequency: 'daily',
		size: '5M',
		max_logs: '10',
		audit_file: path.join( logDir, 'log-rotator.json' ),
		extension: '.log',
		create_symlink: true,
		audit_hash_type: 'sha256',
		verbose: true, // file-stream-rotator itself will log to console too
	} );

	const makeLogger =
		( level: LogLevel, originalLogger: typeof console.log ) =>
		( ...args: Parameters< typeof console.log > ) => {
			writeLogToFile( level, processId, ...args );
			originalLogger( ...args );
		};

	console.log = makeLogger( 'info', console.log.bind( console ) );
	console.warn = makeLogger( 'warn', console.warn.bind( console ) );
	console.error = makeLogger( 'erro', console.error.bind( console ) );

	process.on( 'exit', () => {
		logStream?.end( `[${ new Date().toISOString() }][info][${ processId }] App is terminating` );
	} );

	// Handle Ctrl+C (SIGINT) to gracefully close the log stream
	process.on( 'SIGINT', () => {
		logStream?.end(
			`[${ new Date().toISOString() }][info][${ processId }] App was terminated by SIGINT`
		);
		process.exit();
	} );

	console.log( 'Starting new session' );
}

const originalWarningLog = console.warn;
export function writeLogToFile(
	level: LogLevel,
	processId: string,
	...args: Parameters< typeof console.log >
) {
	const [ message ] = args;

	if ( typeof message === 'string' && message.includes( '%' ) ) {
		const unsupportedPlaceholdersMessage =
			"Attempted to log a string using placeholders, which isn't supported";
		logStream?.write(
			`[${ new Date().toISOString() }][warn][main] ${ unsupportedPlaceholdersMessage }\n`
		);
		originalWarningLog( unsupportedPlaceholdersMessage );
	}

	const stringifiedArgs = args.map( formatLogMessageArg ).join( ' ' );
	logStream?.write(
		`[${ new Date().toISOString() }][${ level }][${ processId }] ${ stringifiedArgs }\n`
	);
}

function formatLogMessageArg( arg: unknown ): string {
	if ( [ 'string', 'number', 'boolean' ].includes( typeof arg ) ) {
		return `${ arg }`;
	}

	if ( arg instanceof Error ) {
		return `${ arg.stack || arg }`;
	}

	return JSON.stringify( arg, null, 2 );
}
