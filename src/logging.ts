import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const originalWarn = console.warn;
const makeLogger =
	( level: string, originalLogger: typeof console.log, logStream: fs.WriteStream ) =>
	( ...args: Parameters< typeof console.log > ) => {
		const [ message ] = args;

		if ( typeof message === 'string' && message.includes( '%' ) ) {
			originalWarn(
				`[${ new Date().toISOString() }][${ level }] Attempting to log string with placeholders which isn't supported\n`
			);
		}

		const stringifiedArgs = args.map( formatLogMessageArg ).join( ' ' );

		logStream.write( `[${ new Date().toISOString() }][${ level }] ${ stringifiedArgs }\n` );
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

	const logDir = app.getPath( 'logs' ); // Resolves to ~/Library/Logs/$appName on macOS
	const logFilePath = path.join( logDir, 'local-environment.log' );

	const logStream = fs.createWriteStream( logFilePath, { flags: 'a' } );

	console.log = makeLogger( 'info', console.log, logStream );
	console.warn = makeLogger( 'warn', console.warn, logStream );
	console.error = makeLogger( 'erro', console.error, logStream ); // Intentional typo so it's the same char-length as the other log levels

	process.on( 'exit', () => {
		logStream.end();
	} );

	// Handle Ctrl+C (SIGINT) to gracefully close the log stream
	process.on( 'SIGINT', () => {
		logStream.end();
		process.exit();
	} );

	console.log( 'Starting new session' );
}
