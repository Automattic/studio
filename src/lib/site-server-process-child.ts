import { PHPRunOptions } from '@php-wasm/universal';
import { startServer, type WPNowServer } from '../../vendor/wp-now/src';
import { WPNowOptions } from '../../vendor/wp-now/src/config';
import { setupLogging } from '../logging';
import type { MessageName } from './site-server-process';

// Setup logging for the forked process
if ( process.env.STUDIO_APP_LOGS_PATH ) {
	setupLogging( {
		processId: 'site-server-process',
		isForkedProcess: true,
		logDir: process.env.STUDIO_APP_LOGS_PATH,
	} );
}

const options = JSON.parse( process.argv[ 2 ] ) as WPNowOptions;
let server: WPNowServer;

async function start( message: string, messageId: number ) {
	server = await startServer( options );
	process.parentPort.postMessage( {
		message,
		messageId,
		data: {
			php: {
				documentRoot: server.php.documentRoot,
			},
		},
	} );
}

async function stop( message: string, messageId: number ) {
	await server.stopServer();
	process.parentPort.postMessage( {
		message,
		messageId,
	} );
}

async function runPhp( message: string, messageId: number, data: PHPRunOptions ) {
	const response = await server.php.run( data );
	process.parentPort.postMessage( { message, messageId, data: response.text } );
}

process.parentPort.on( 'message', async ( { data: messageData } ) => {
	const { message, messageId, data }: { message: MessageName; messageId: number; data: unknown } =
		messageData;
	try {
		switch ( message ) {
			case 'start-server':
				await start( message, messageId );
				break;
			case 'stop-server':
				await stop( message, messageId );
				break;
			case 'run-php':
				await runPhp( message, messageId, data as PHPRunOptions );
				break;
		}
	} catch ( error ) {
		const errorObj = error as Error;
		if ( ! errorObj ) {
			process.parentPort.postMessage( { message, messageId, error: Error( 'Unknown Error' ) } );
			return;
		}
		process.parentPort.postMessage( {
			message,
			messageId,
			error: errorObj,
		} );
	}
} );
