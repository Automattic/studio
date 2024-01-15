import crypto from 'crypto';
import nodePath from 'path';
import { pathExists, recursiveCopyDirectory } from './fs-utils';
import { getWpNowConfig, startServer, type Server as WPNowServer } from '@wp-now/wp-now';
import { portFinder } from './port-finder';

const servers = new Map< string, SiteServer >();

export async function createSiteServer( path: string ): Promise< SiteServer | null > {
	if ( await pathExists( path ) ) {
		// We can only create into a clean directory
		return null;
	}

	const details = {
		id: crypto.randomUUID(),
		name: nodePath.basename( path ),
		path,
		running: false,
	} as const;

	await recursiveCopyDirectory( nodePath.resolve( 'wp-files/latest/wordpress' ), path );

	const server = new SiteServer( details );

	servers.set( details.id, server );
	return server;
}

export function getSiteServer( id: string ): SiteServer | undefined {
	return servers.get( id );
}

export class SiteServer {
	server?: WPNowServer;

	constructor( public details: SiteDetails ) {}

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

		if ( ! this.details.running ) {
			return;
		}

		const { running: _running, port: _port, url: _url, ...rest } = this.details;
		this.details = { running: false, ...rest };
	}
}
