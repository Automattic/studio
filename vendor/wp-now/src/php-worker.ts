import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { loadNodeRuntime } from '@php-wasm/node';
import { PHP, PHPRequest, PHPResponse } from '@php-wasm/universal';
import startWPNow from './wp-now';

// Worker thread code
if ( ! isMainThread ) {
	const { options, workerId } = workerData;

	process.on('uncaughtException', (error) => {
		console.error(`Worker ${workerId} uncaught exception:`, error);
		parentPort?.postMessage({
			type: 'error',
			error: error instanceof Error ? error.message : 'Unknown error',
		});
		process.exit(1);
	});

	process.on('unhandledRejection', (reason) => {
		console.error(`Worker ${workerId} unhandled rejection:`, reason);
		parentPort?.postMessage({
			type: 'error',
			error: reason instanceof Error ? reason.message : 'Unknown error',
		});
		process.exit(1);
	});

	function initializeWorker() {
		console.log(`Worker ${workerId}: Starting initialization...`);
		
		if (!options || !options.projectPath) {
			throw new Error('Invalid worker options');
		}

		// Initialize PHP instance
		console.log(`Worker ${workerId}: Starting WPNow...`);
		console.log(`Worker ${workerId}: Options:`, { ...options, adminPassword: '[REDACTED]' });
		
		startWPNow(options).then(({ php }) => {
			console.log(`Worker ${workerId} initialized PHP runtime successfully`);

			// Handle requests
			parentPort?.on('message', async (data) => {
				const { requestId, request } = data;
				try {
					const response = await php.requestHandler.request(request);
					parentPort?.postMessage({ requestId, response, success: true });
				} catch (error) {
					console.error(`Worker ${workerId} error:`, error);
					parentPort?.postMessage({
						requestId,
						error: error instanceof Error ? error.message : 'Unknown error',
						success: false,
					});
				}
			});

			console.log(`Worker ${workerId}: Setup complete, signaling ready...`);
			// Signal ready
			parentPort?.postMessage({ type: 'ready', workerId });
			console.log(`Worker ${workerId}: Ready signal sent`);
		}).catch((error) => {
			console.error(`Worker ${workerId} failed to initialize:`, error);
			parentPort?.postMessage({
				type: 'error',
				error: error instanceof Error ? error.message : 'Failed to initialize worker',
			});
			process.exit(1);
		});
	}

	// Start initialization
	initializeWorker();
}
