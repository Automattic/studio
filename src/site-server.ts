import nodePath from 'path';
import { pathExists, recursiveCopyDirectory, isEmptyDir } from './fs-utils';
import { getWpNowConfig, startServer, type Server as WPNowServer } from '@wp-now/wp-now';
import { portFinder } from './port-finder';

const servers = new Map< string, SiteServer >();

export async function createSiteWorkingDirectory( path: string ): Promise< boolean > {
	if ( ( await pathExists( path ) ) && ! ( await isEmptyDir( path ) ) ) {
		// We can only create into a clean directory
		return false;
	}

	await recursiveCopyDirectory( nodePath.resolve( 'wp-files/latest/wordpress' ), path );

	return true;
}

export async function stopAllServersOnQuit() {
	// We're quitting so this doesn't have to be tidy, just stop the
	// servers as directly as possible.
	await Promise.all( [ ...servers.values() ].map( ( server ) => server.server?.stopServer() ) );
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

		console.log( 'Starting server with options', options );
		this.server = await startServer( options );

		this.details = {
			...this.details,
			url: this.server.url,
			port: this.server.options.port,
			running: true,
		};
	}

	async stop() {
		console.log( 'Stopping server with ID', this.details.id );
		this.server?.stopServer();
		this.server = undefined;

		if ( ! this.details.running ) {
			return;
		}

		const { running: _running, port: _port, url: _url, ...rest } = this.details;
		this.details = { running: false, ...rest };
	}
}
