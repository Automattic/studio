import { isMainThread, workerData } from 'worker_threads';
import { HTTPMethod, PHPRequest, PHPRunOptions } from '@php-wasm/universal';
import { setupLogging } from 'src/logging';
import { startServer, type WPNowServer } from 'vendor/wp-now/src';
import { WPNowOptions } from 'vendor/wp-now/src/config';
import { PHPWorkerPool } from 'vendor/wp-now/src/php-worker-pool';
import type { MessageName } from 'src/lib/site-server-process';
import 'source-map-support/register';

type MessagePayload = {
	message: MessageName;
	messageId: number;
	data: unknown;
};

type Handler = ( messagePayload: MessagePayload ) => Promise< void >;
type Handlers = { [ K in MessageName ]: Handler };

// Setup logging for the forked process
if ( process.env.STUDIO_APP_LOGS_PATH ) {
	setupLogging( {
		processId: `site-server-process-${ process.pid }`,
		isForkedProcess: true,
		logDir: process.env.STUDIO_APP_LOGS_PATH,
	} );
}

// Get options from either process args (main thread) or worker data (worker thread)
const options = isMainThread
	? ( JSON.parse( process.argv[ 2 ] ) as WPNowOptions )
	: ( workerData.options as WPNowOptions );

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
			documentRoot: options.projectPath, // Use project path directly since we don't need PHP instance details
		},
	};
}

async function stop() {
	if ( server ) {
		await server.stopServer();
	}
}

async function runPhp( data: unknown ) {
	if ( ! server ) {
		throw new Error( 'Server not started' );
	}
	console.log( 'site-server-process-child runPhp', data );
	const request = data as PHPRequest;
	return await server.phpWorkerPool.handleRequest( request );
}

function createHandler< T >( handler: ( data: unknown ) => Promise< T > ) {
	return async ( messagePayload: MessagePayload ) => {
		try {
			const response = await handler( messagePayload.data );
			process.send!( {
				message: messagePayload.message,
				messageId: messagePayload.messageId,
				data: response,
			} );
		} catch ( error ) {
			const errorObj = error as Error;
			console.error( 'Error in handler:', error );
			if ( errorObj?.stack ) {
				console.error( 'Stack trace:', errorObj.stack );
			}
			process.send!( {
				message: messagePayload.message,
				messageId: messagePayload.messageId,
				error: errorObj?.stack || errorObj?.message || 'Unknown Error',
			} );
		}
	};
}

process.on( 'message', async ( messagePayload: unknown ) => {
	if ( ! messagePayload || typeof messagePayload !== 'object' ) {
		console.error( 'Invalid message payload received:', messagePayload );
		return;
	}

	const payload = messagePayload as MessagePayload;
	if ( ! payload.message || ! payload.messageId ) {
		console.error( 'Message payload missing required fields:', payload );
		return;
	}

	const handler = handlers[ payload.message ];
	if ( ! handler ) {
		process.send!( {
			message: payload.message,
			messageId: payload.messageId,
			error: `No handler defined for message '${ payload.message }'`,
		} );
		return;
	}

	await handler( payload );
} );

// Handle process termination signals
process.on( 'SIGTERM', async () => {
	console.log( `Process ${ process.pid } received SIGTERM, shutting down...` );
	if ( server ) {
		try {
			await server.stopServer();
		} catch ( error ) {
			console.error( 'Error stopping server during shutdown:', error );
		}
	}
	process.exit( 0 );
} );

process.on( 'SIGINT', async () => {
	console.log( `Process ${ process.pid } received SIGINT, shutting down...` );
	if ( server ) {
		try {
			await server.stopServer();
		} catch ( error ) {
			console.error( 'Error stopping server during shutdown:', error );
		}
	}
	process.exit( 0 );
} );
