import { HTTPMethod, PHPRequest, PHPRunOptions } from '@php-wasm/universal';
import { WPNowOptions } from 'vendor/wp-now/src/config';
import { PHPWorkerPool } from './php-worker-pool';

export class LoadBalancer {
	private workerPool: PHPWorkerPool;
	private requestCounts: Map< number, number >;

	constructor( options: WPNowOptions, numWorkers = 6 ) {
		this.workerPool = new PHPWorkerPool( options, numWorkers );
		this.requestCounts = new Map();

		// Initialize request counts
		for ( let i = 0; i < numWorkers; i++ ) {
			this.requestCounts.set( i, 0 );
		}
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

	getServerStats(): string {
		return Array.from( this.requestCounts.entries() )
			.map( ( [ index, count ] ) => `Worker ${ index }: ${ count } requests` )
			.join( '\n' );
	}

	async stopAll(): Promise< void > {
		console.log( 'Stopping all PHP workers' );
		console.log( this.getServerStats() );
		await this.workerPool.shutdown();
	}
}
