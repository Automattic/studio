import { WPNowServer } from './start-server';

export class LoadBalancer {
	private servers: WPNowServer[];
	private currentIndex: number;
	private requestCounts: Map< number, number >;

	constructor( servers: WPNowServer[] ) {
		this.servers = servers;
		this.currentIndex = 0;
		this.requestCounts = new Map();

		// Initialize request counts for each server
		servers.forEach( ( _, index ) => {
			this.requestCounts.set( index, 0 );
		} );

		console.log( `LoadBalancer initialized with ${ servers.length } PHP instances` );
	}

	getNextServer(): WPNowServer {
		if ( ! this.servers.length ) {
			throw new Error( 'No PHP servers available' );
		}

		const server = this.servers[ this.currentIndex ];

		// Update request count for this server
		const currentCount = this.requestCounts.get( this.currentIndex ) || 0;
		this.requestCounts.set( this.currentIndex, currentCount + 1 );

		// Add more detailed logging
		console.log(
			`Using PHP instance ${ this.currentIndex } for request (total: ${ currentCount + 1 })`
		);
		console.log( `PHP instance details: ${ server.php.constructor.name }` );

		// Move to next server in round-robin fashion
		this.currentIndex = ( this.currentIndex + 1 ) % this.servers.length;

		return server;
	}

	getServerStats(): string {
		return Array.from( this.requestCounts.entries() )
			.map( ( [ index, count ] ) => `Instance ${ index }: ${ count } requests` )
			.join( '\n' );
	}

	async stopAll(): Promise< void > {
		console.log( 'Stopping all PHP instances' );
		console.log( this.getServerStats() );
		await Promise.all( this.servers.map( ( server ) => server.stopServer() ) );
	}
}
