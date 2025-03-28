import { Server } from 'http';
import express from 'express';
import { portFinder } from './port-finder';

class SimpleServer {
	private server: Server | null = null;
	private port: number | null = null;

	async start( site: SiteDetails ): Promise< number > {
		console.log( 'site', site );
		if ( ! site.id || ! site.path ) {
			throw new Error( 'Site ID is required' );
		}

		if ( this.server ) {
			return this.port!;
		}

		const app = express();
		this.port = await portFinder.getOpenPort();

		// Add a basic route handler
		app.get( '/', ( req, res ) => {
			res.send( 'Simple Server is running on port ' + this.port );
		} );

		// Start server
		await new Promise< void >( ( resolve ) => {
			this.server = app.listen( this.port, () => resolve() );
		} );

		return this.port;
	}

	async stop(): Promise< void > {
		if ( this.server ) {
			await new Promise< void >( ( resolve ) => {
				this.server!.close( () => resolve() );
			} );
			this.server = null;
		}
		if ( this.port ) {
			portFinder.releasePort( this.port );
			this.port = null;
		}
	}
}

export const simpleServer = new SimpleServer();
