import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { loadNodeRuntime } from '@php-wasm/node';
import { PHP, PHPRequest, PHPResponse } from '@php-wasm/universal';
import startWPNow from './wp-now';

// Worker thread code
if ( ! isMainThread ) {
	const { options, workerId } = workerData;

	try {
		// Initialize PHP instance
		const { php } = await startWPNow( options );
		console.log( `Worker ${ workerId } initialized` );

		// Handle requests
		parentPort?.on( 'message', async ( data ) => {
			const { requestId, request } = data;
			try {
				const response = await php.requestHandler.request( request );
				parentPort?.postMessage( { requestId, response, success: true } );
			} catch ( error ) {
				console.error( `Worker ${ workerId } error:`, error );
				parentPort?.postMessage( {
					requestId,
					error: error instanceof Error ? error.message : 'Unknown error',
					success: false,
				} );
			}
		} );

		// Signal ready
		parentPort?.postMessage( { type: 'ready', workerId } );
	} catch ( error ) {
		console.error( `Worker ${ workerId } failed to initialize:`, error );
		parentPort?.postMessage( {
			type: 'error',
			error: error instanceof Error ? error.message : 'Failed to initialize worker',
		} );
	}
}
