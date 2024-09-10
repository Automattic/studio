import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { parse } from 'shell-quote';
import { getWpNowConfig } from '../vendor/wp-now/src';
import { WPNowMode } from '../vendor/wp-now/src/config';
import { DEFAULT_PHP_VERSION } from '../vendor/wp-now/src/constants';
import { getWordPressVersionPath } from '../vendor/wp-now/src/download';
import { pathExists, recursiveCopyDirectory, isEmptyDir } from './lib/fs-utils';
import { decodePassword } from './lib/passwords';
import { phpGetThemeDetails } from './lib/php-get-theme-details';
import { portFinder } from './lib/port-finder';
import { sanitizeForLogging } from './lib/sanitize-for-logging';
import { getPreferredSiteLanguage } from './lib/site-language';
import SiteServerProcess from './lib/site-server-process';
import WpCliProcess, { MessageCanceled, WpCliResult } from './lib/wp-cli-process';
import { purgeWpConfig } from './lib/wp-versions';
import { createScreenshotWindow } from './screenshot-window';
import { getSiteThumbnailPath } from './storage/paths';

const servers = new Map< string, SiteServer >();
const deletedServers: string[] = [];

export async function createSiteWorkingDirectory(
	path: string,
	wpVersion = 'latest'
): Promise< boolean > {
	if ( ( await pathExists( path ) ) && ! ( await isEmptyDir( path ) ) ) {
		// We can only create into a clean directory
		return false;
	}

	await purgeWpConfig( wpVersion );
	await recursiveCopyDirectory( getWordPressVersionPath( wpVersion ), path );

	return true;
}

export async function stopAllServersOnQuit() {
	// We're quitting so this doesn't have to be tidy, just stop the
	// servers as directly as possible.
	await Promise.all( [ ...servers.values() ].map( ( server ) => server.server?.stop() ) );
}

export class SiteServer {
	server?: SiteServerProcess;
	wpCliExecutor?: WpCliProcess;

	private constructor( public details: SiteDetails ) {}

	static get( id: string ): SiteServer | undefined {
		return servers.get( id );
	}

	static isDeleted( id: string ) {
		return deletedServers.includes( id );
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
		await this.wpCliExecutor?.stop();
		deletedServers.push( this.details.id );
		servers.delete( this.details.id );
		portFinder.releasePort( this.details.port );
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
			adminPassword: decodePassword( this.details.adminPassword ?? '' ),
			siteTitle: this.details.name,
			php: this.details.phpVersion,
		} );
		const absoluteUrl = `http://localhost:${ port }`;
		options.absoluteUrl = absoluteUrl;
		options.siteLanguage = await getPreferredSiteLanguage( options.wordPressVersion );

		if ( options.mode !== WPNowMode.WORDPRESS ) {
			throw new Error(
				`Site server started with Playground's '${ options.mode }' mode. Studio only supports 'wordpress' mode.`
			);
		}

		console.log( 'Starting server with options', sanitizeForLogging( options ) );
		this.server = new SiteServerProcess( options );
		await this.server.start();

		if ( this.server.options.port === undefined ) {
			throw new Error( 'Server started with no port' );
		}

		const themeDetails = await phpGetThemeDetails( this.server );

		this.details = {
			...this.details,
			url: this.server.url,
			port: this.server.options.port,
			phpVersion: this.server.options.phpVersion ?? DEFAULT_PHP_VERSION,
			running: true,
			themeDetails,
		};
	}

	updateSiteDetails( site: SiteDetails ) {
		this.details = {
			...this.details,
			name: site.name,
			path: site.path,
			phpVersion: site.phpVersion,
		};
	}

	async stop() {
		console.log( 'Stopping server with ID', this.details.id );
		try {
			await this.server?.stop();
		} catch ( error ) {
			console.error( error );
		}
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
		return fs.promises
			.mkdir( outDir, { recursive: true } )
			.then( waitForCapture )
			.then( ( image ) => fs.promises.writeFile( outPath, image.toPNG() ) )
			.catch( Sentry.captureException )
			.finally( () => window.destroy() );
	}

	async executeWpCliCommand( args: string ): Promise< WpCliResult > {
		const projectPath = this.details.path;

		if ( ! this.wpCliExecutor ) {
			this.wpCliExecutor = new WpCliProcess( projectPath );
			await this.wpCliExecutor.init();
		}

		const wpCliArgs = parse( args );

		// The parsing of arguments can include shell operators like `>` or `||` that the app don't support.
		const isValidCommand = wpCliArgs.every(
			( arg: unknown ) => typeof arg === 'string' || arg instanceof String
		);
		if ( ! isValidCommand ) {
			throw Error( `Cannot execute wp-cli command with arguments: ${ args }` );
		}

		try {
			return await this.wpCliExecutor.execute( wpCliArgs as string[] );
		} catch ( error ) {
			if ( ( error as MessageCanceled )?.canceled ) {
				return { stdout: '', stderr: 'wp-cli command canceled', exitCode: 1 };
			}

			Sentry.captureException( error );
			return { stdout: '', stderr: 'error when executing wp-cli command', exitCode: 1 };
		}
	}
}
