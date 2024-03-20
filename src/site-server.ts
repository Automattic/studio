import { app } from 'electron';
import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { getWpNowConfig, startServer, type WPNowServer } from '../vendor/wp-now/src';
import { pathExists, recursiveCopyDirectory, isEmptyDir } from './lib/fs-utils';
import { phpGetThemeDetails } from './lib/php-get-theme-details';
import { portFinder } from './lib/port-finder';
import { createScreenshotWindow } from './screenshot-window';
import { getSiteThumbnailPath } from './storage/paths';

const servers = new Map< string, SiteServer >();

export async function createSiteWorkingDirectory( path: string ): Promise< boolean > {
	if ( ( await pathExists( path ) ) && ! ( await isEmptyDir( path ) ) ) {
		// We can only create into a clean directory
		return false;
	}

	const wpFilesPath = nodePath.join( getResourcesPath(), 'wp-files', 'latest', 'wordpress' );

	await recursiveCopyDirectory( wpFilesPath, path );

	return true;
}

function getResourcesPath(): string {
	if ( process.env.NODE_ENV === 'development' ) {
		return process.cwd();
	}

	const exePath = nodePath.dirname( app.getPath( 'exe' ) );

	if ( process.platform === 'darwin' ) {
		return nodePath.resolve( exePath, '..', 'Resources' );
	}

	return nodePath.join( exePath, 'resources' );
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

	async delete() {
		const thumbnailPath = getSiteThumbnailPath( this.details.id );
		if ( fs.existsSync( thumbnailPath ) ) {
			await fs.promises.unlink( thumbnailPath );
		}
		await this.stop();
		servers.delete( this.details.id );
	}

	async start() {
		if ( this.details.running || this.server ) {
			return;
		}
		const port = await portFinder.getOpenPort( this.details.port );
		portFinder.addUnavailablePort( this.details.port );
		const options = await getWpNowConfig( {
			path: this.details.path,
			port,
			siteTitle: this.details.name,
		} );
		const absoluteUrl = `http://localhost:${ port }`;
		options.absoluteUrl = absoluteUrl;

		console.log( 'Starting server with options', options );
		this.server = await startServer( options );

		if ( this.server.options.port === undefined ) {
			throw new Error( 'Server started with no port' );
		}

		const themeDetails = await phpGetThemeDetails( this.server.php );

		this.details = {
			...this.details,
			url: this.server.url,
			port: this.server.options.port,
			running: true,
			themeDetails,
		};

		await this.updateCachedThumbnail();
	}

	updateSiteDetails( site: SiteDetails ) {
		this.details = {
			...this.details,
			name: site.name,
			path: site.path,
		};
	}

	async stop() {
		console.log( 'Stopping server with ID', this.details.id );
		this.server?.stopServer();
		this.server = undefined;

		if ( ! this.details.running ) {
			return;
		}

		const { running, url, ...rest } = this.details;
		this.details = { running: false, ...rest };
	}

	async updateCachedThumbnail() {
		if ( ! this.details.running ) {
			throw new Error( 'Cannot update thumbnail for a stopped server' );
		}

		const captureUrl = new URL( '/?studio-hide-adminbar', this.details.url );
		const { window, waitForCapture } = createScreenshotWindow( captureUrl.href );

		const outPath = getSiteThumbnailPath( this.details.id );
		const outDir = nodePath.dirname( outPath );

		// Continue taking the screenshot asynchronously so we don't prevent the
		// UI from showing the server is now available.
		fs.promises
			.mkdir( outDir, { recursive: true } )
			.then( waitForCapture )
			.then( ( image ) => fs.promises.writeFile( outPath, image.toPNG() ) )
			.catch( Sentry.captureException )
			.finally( () => window.destroy() );
	}
}
