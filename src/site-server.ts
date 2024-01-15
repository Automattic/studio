import nodePath from 'path';
import { pathExists, recursiveCopyDirectory } from './fs-utils';
import { getWpNowConfig, startServer, type Server as WPNowServer } from '@wp-now/wp-now';
import { portFinder } from './port-finder';

const servers = new Map< string, SiteServer >();

export async function createSiteWorkingDirectory( path: string ): Promise< boolean > {
	if ( await pathExists( path ) ) {
		// We can only create into a clean directory
		return false;
	}

	await recursiveCopyDirectory( nodePath.resolve( 'wp-files/latest/wordpress' ), path );

	return true;
}

export class SiteServer {
	server?: WPNowServer;

	private constructor( public details: SiteDetails ) {}

	static get( id: string ): SiteServer | undefined {
		return servers.get( id );
	}

	static create( details: StoppedSiteDetails ): SiteServer {
		const server = new SiteServer( details );
		servers.set( details.id, server );
		return server;
	}

	async start() {
		if ( this.details.running || this.server ) {
			return;
		}

		const port = await portFinder.getOpenPort();
		const options = await getWpNowConfig( {
			path: this.details.path,
			port,
		} );

		console.log( 'Starting server with options:' );
		console.log( { options } );
		this.server = await startServer( options );

		this.details = {
			...this.details,
			url: this.server.url,
			port: this.server.options.port,
			running: true,
		};
	}

	async stop() {
		this.server?.stopServer();
		this.server = undefined;

		if ( ! this.details.running ) {
			return;
		}

		const { running: _running, port: _port, url: _url, ...rest } = this.details;
		this.details = { running: false, ...rest };
	}
}
