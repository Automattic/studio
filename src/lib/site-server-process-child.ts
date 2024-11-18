import { PHPRunOptions } from '@php-wasm/universal';
import { startServer, type WPNowServer } from '../../vendor/wp-now/src';
import { WPNowOptions } from '../../vendor/wp-now/src/config';
import { setupLogging } from '../logging';
import type { MessageName } from './site-server-process';

type Handler = ( message: string, messageId: number, data: unknown ) => void;
type Handlers = { [ K in MessageName ]: Handler };

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

const handlers: Handlers = {
	'start-server': createHandler( start ),
	'stop-server': createHandler( stop ),
	'run-php': createHandler( runPhp ),
};

async function start() {
	server = await startServer( options );
	return {
		php: {
			documentRoot: server.php.documentRoot,
		},
	};
}

async function stop() {
	await server?.stopServer();
}

async function runPhp( data: unknown ) {
	const request = data as PHPRunOptions;
	if ( ! request ) {
		throw Error( 'PHP request is not valid' );
	}
	const response = await server.php.run( request );
	return response.text;
}

function createHandler< T >( handler: ( data: unknown ) => T ) {
	return async ( message: string, messageId: number, data: unknown ) => {
		try {
			const response = await handler( data );
			process.parentPort.postMessage( {
				message,
				messageId,
				data: response,
			} );
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
	};
}

process.parentPort.on( 'message', async ( { data: messagePayload } ) => {
	const { message, messageId, data }: { message: MessageName; messageId: number; data: unknown } =
		messagePayload;
	const handler = handlers[ message ];
	if ( ! handler ) {
		process.parentPort.postMessage( {
			message,
			messageId,
			error: Error( `No handler defined for message '${ message }'` ),
		} );
		return;
	}
	await handler( message, messageId, data );
} );
