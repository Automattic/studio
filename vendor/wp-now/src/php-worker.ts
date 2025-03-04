import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { loadNodeRuntime } from '@php-wasm/node';
import { PHP, PHPRequest, PHPResponse, PHPRunOptions } from '@php-wasm/universal';
import { WPNowOptions } from './config';
import startWPNow from './wp-now';
import 'source-map-support/register';

interface WorkerMessage {
	type: 'request' | 'shutdown';
	requestId: string;
	request: PHPRequest | PHPRunOptions;
}

interface WorkerResponse {
	requestId: string;
	response?: PHPResponse;
	error?: string;
	success: boolean;
	type?: 'error' | 'ready';
	workerId?: string;
}

// Worker thread code
if ( ! isMainThread ) {
	const { options, workerId }: { options: WPNowOptions; workerId: string } = workerData;

	process.on( 'SIGTERM', () => {
		console.log( `Worker ${ workerId }: Received termination signal, exiting...` );
		process.exit( 0 );
	} );

	process.on( 'uncaughtException', ( error ) => {
		console.error( `Worker ${ workerId } uncaught exception:`, error );
		console.error( 'Stack trace:', error?.stack );
		parentPort?.postMessage( {
			type: 'error',
			error: error instanceof Error ? `${ error.message }\n${ error.stack }` : 'Unknown error',
		} as WorkerResponse );
		process.exit( 1 );
	} );

	process.on( 'unhandledRejection', ( reason ) => {
		console.error( `Worker ${ workerId } unhandled rejection:`, reason );
		if ( reason instanceof Error ) {
			console.error( 'Stack trace:', reason.stack );
		}
		parentPort?.postMessage( {
			type: 'error',
			error: reason instanceof Error ? `${ reason.message }\n${ reason.stack }` : 'Unknown error',
		} as WorkerResponse );
		process.exit( 1 );
	} );

	// eslint-disable-next-line no-inner-declarations
	function initializeWorker() {
		console.log( `Worker ${ workerId }: Starting initialization...` );

		if ( ! options || ! options.projectPath ) {
			throw new Error( 'Invalid worker options' );
		}

		// Initialize PHP instance
		console.log( `Worker ${ workerId }: Starting WPNow...` );
		console.log( `Worker ${ workerId }: Options:`, { ...options, adminPassword: '[REDACTED]' } );

		startWPNow( options )
			.then( ( { php } ) => {
				console.log( `Worker ${ workerId } initialized PHP runtime successfully` );

				// Handle requests
				parentPort?.on( 'message', async ( data: WorkerMessage ) => {
					const { type, requestId, request } = data;
					if ( type === 'shutdown' ) {
						process.exit( 0 );
					}
					try {
						console.log(
							'inside worker',
							'workerId',
							workerId,
							'requestId',
							requestId,
							'url' in request ? request.url : '<somephpcode>'
						);

						if ( 'url' in request ) {
							const response = await php.requestHandler.request( request );
							parentPort?.postMessage( {
								requestId,
								response,
								success: true,
							} as WorkerResponse );
						} else {
							const response = await php.run( request );
							parentPort?.postMessage( {
								requestId,
								response,
								success: true,
							} as WorkerResponse );
						}
					} catch ( error ) {
						console.error( `Worker ${ workerId } error:`, error );
						parentPort?.postMessage( {
							requestId,
							error: error instanceof Error ? error.message : 'Unknown error',
							success: false,
						} as WorkerResponse );
					}
				} );

				console.log( `Worker ${ workerId }: Setup complete, signaling ready...` );
				// Signal ready
				parentPort?.postMessage( { type: 'ready', workerId } as WorkerResponse );
				console.log( `Worker ${ workerId }: Ready signal sent` );
			} )
			.catch( ( error ) => {
				console.error( `Worker ${ workerId } failed to initialize:`, error );
				parentPort?.postMessage( {
					type: 'error',
					error: error instanceof Error ? error.message : 'Failed to initialize worker',
				} as WorkerResponse );
				process.exit( 1 );
			} );
	}

	// Start initialization
	initializeWorker();
}
