import { app } from 'electron';
import path from 'path';
import * as FileStreamRotator from 'file-stream-rotator';

const originalWarn = console.warn;
const makeLogger =
	( level: string, originalLogger: typeof console.log, write: ( str: string ) => void ) =>
	( ...args: Parameters< typeof console.log > ) => {
		const [ message ] = args;

		if ( typeof message === 'string' && message.includes( '%' ) ) {
			originalWarn(
				`[${ new Date().toISOString() }][${ level }] Attempting to log string with placeholders which isn't supported\n`
			);
		}

		const stringifiedArgs = args.map( formatLogMessageArg ).join( ' ' );

		write( `[${ new Date().toISOString() }][${ level }] ${ stringifiedArgs }\n` );
		originalLogger( ...args );
	};

function formatLogMessageArg( arg: unknown ): string {
	if ( [ 'string', 'number', 'boolean' ].includes( typeof arg ) ) {
		return `${ arg }`;
	}

	if ( arg instanceof Error ) {
		return `${ arg.stack || arg }`;
	}

	return JSON.stringify( arg, null, 2 );
}

export function setupLogging() {
	// Set the logging path to the default for the platform.
	app.setAppLogsPath();

	// During development logs will be written to ~/Library/Logs/Electron/*.log because technically
	// the app is still called Electron from the system's point of view (see `CFBundleDisplayName`)
	// In the release build logs will be written to ~/Library/Logs/Local Environment/*.log
	const logDir = app.getPath( 'logs' );

	const logStream = FileStreamRotator.getStream( {
		filename: path.join( logDir, 'local-environment-%DATE%' ),
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

	console.log = makeLogger( 'info', console.log, logStream.write.bind( logStream ) );
	console.warn = makeLogger( 'warn', console.warn, logStream.write.bind( logStream ) );
	console.error = makeLogger( 'erro', console.error, logStream.write.bind( logStream ) ); // Intentional typo so it's the same char-length as the other log levels

	process.on( 'exit', () => {
		logStream.end( 'App is terminating' );
	} );

	// Handle Ctrl+C (SIGINT) to gracefully close the log stream
	process.on( 'SIGINT', () => {
		logStream.end( 'App was terminated by SIGINT' );
		process.exit();
	} );

	console.log( 'Starting new session' );
}
