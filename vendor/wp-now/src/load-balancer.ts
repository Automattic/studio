import { PHPRequest } from '@php-wasm/universal';
import { WPNowOptions } from 'vendor/wp-now/src/config';
import { PHPWorkerPool } from './php-worker-pool';

export class LoadBalancer {
	private workerPool: PHPWorkerPool;

	constructor( options: WPNowOptions, numWorkers = 6 ) {
		this.workerPool = new PHPWorkerPool( options, numWorkers );
	}

	async initialize() {
		await this.workerPool.initialize();
		console.log( 'LoadBalancer initialized with worker pool' );
	}

	async handleRequest( request: PHPRequest ) {
		try {
			return await this.workerPool.handleRequest( request );
		} catch ( error ) {
			console.error( 'Request failed:', error );
			throw error;
		}
	}

	async stopAll(): Promise< void > {
		console.log( 'Stopping all PHP workers' );
		await this.workerPool.shutdown();
	}
}
