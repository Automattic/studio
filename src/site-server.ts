import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { BlueprintV1Declaration } from '@wp-playground/blueprints';
import fsExtra from 'fs-extra';
import { parse } from 'shell-quote';
import { portFinder } from 'common/lib/port-finder';
import { deleteSiteCertificate, generateSiteCertificate } from 'src/lib/certificate-manager';
import { getSiteUrl } from 'src/lib/get-site-url';
import { removeDomainFromHosts, updateDomainInHosts } from 'src/lib/hosts-file';
import { updateSiteUrl } from 'src/lib/update-site-url';
import { setupWordPressSite, getWordPressProvider } from 'src/lib/wordpress-provider';
import WpCliProcess, { MessageCanceled, WpCliResult } from 'src/lib/wp-cli-process';
import { CliServerProcess } from 'src/modules/cli/lib/cli-server-process';
import { createSiteViaCli, type CreateSiteOptions } from 'src/modules/cli/lib/cli-site-creator';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { createScreenshotWindow } from 'src/screenshot-window';
import { getSiteThumbnailPath } from 'src/storage/paths';
import { loadUserData } from 'src/storage/user-data';
import type { WordPressServerProcess } from 'src/lib/wordpress-provider/types';

const servers = new Map< string, SiteServer >();
const deletedServers: string[] = [];

export async function createSiteWorkingDirectory(
	server: SiteServer,
	wpVersion = 'latest'
): Promise< boolean > {
	return setupWordPressSite( server, wpVersion );
}

export async function stopAllServersOnQuit() {
	// We're quitting so this doesn't have to be tidy, just stop the
	// servers as directly as possible.
	// Preserve autoStart so sites will restart on next app launch.
	// Use silent mode to avoid terminal errors during quit.
	return new Promise< void >( ( resolve ) => {
		const [ emitter ] = executeCliCommand( [ 'site', 'stop-all', '--auto-start' ], {
			silent: true,
		} );
		emitter.on( 'success', resolve );
		emitter.on( 'failure', resolve );
		emitter.on( 'error', () => resolve() );
	} );
}

function getAbsoluteUrl( details: SiteDetails ): string {
	if ( details.customDomain ) {
		const protocol = details.enableHttps ? 'https' : 'http';
		return `${ protocol }://${ details.customDomain }`;
	}

	return `http://localhost:${ details.port }`;
}

// We use SiteDetails for storing it in appdata-v1.json, so this meta was introduced for extra data which is not stored locally
type SiteServerMeta = {
	wpVersion?: string;
	blueprint?: BlueprintV1Declaration;
};

export class SiteServer {
	server?: WordPressServerProcess;
	wpCliExecutor?: WpCliProcess;
	/**
	 * Indicates whether a Studio-managed operation (start/stop) is in progress.
	 * When true, file watchers should ignore site events to prevent interference
	 * with the ongoing operation.
	 */
	hasOngoingOperation = false;

	private constructor(
		public details: SiteDetails,
		public meta: SiteServerMeta
	) {}

	static get( id: string ): SiteServer | undefined {
		return servers.get( id );
	}

	static getByPath( path: string ): SiteServer | undefined {
		for ( const server of servers.values() ) {
			if ( server.details.path === path ) {
				return server;
			}
		}
		return undefined;
	}

	static isDeleted( id: string ) {
		return deletedServers.includes( id );
	}

	static register( details: StoppedSiteDetails, meta: SiteServerMeta = {} ): SiteServer {
		const server = new SiteServer( details, meta );
		servers.set( details.id, server );
		return server;
	}

	static async create(
		options: CreateSiteOptions,
		meta: SiteServerMeta = {}
	): Promise< { server: SiteServer; details: SiteDetails } > {
		// Use the siteId from frontend if provided, for placeholder consistency
		const placeholderDetails: StoppedSiteDetails = {
			id: options.siteId || crypto.randomUUID(),
			name: options.name || options.path,
			path: options.path,
			port: 0,
			phpVersion: options.phpVersion || '',
			running: false,
		};
		const server = SiteServer.register( placeholderDetails, meta );
		server.hasOngoingOperation = true;

		try {
			const result = await createSiteViaCli( options );
			const userData = await loadUserData();
			const siteData = userData.sites.find( ( s ) => s.id === result.id );
			if ( ! siteData ) {
				throw new Error( `Site with ID ${ result.id } not found in appdata after CLI creation` );
			}

			let siteDetails: SiteDetails;
			if ( result.running ) {
				const url = siteData.customDomain
					? `${ siteData.enableHttps ? 'https' : 'http' }://${ siteData.customDomain }`
					: `http://localhost:${ siteData.port }`;
				siteDetails = {
					...siteData,
					running: true,
					url,
				};
			} else {
				siteDetails = {
					...siteData,
					running: false,
				};
			}

			// Update the server with the real details from CLI
			servers.delete( placeholderDetails.id );
			servers.set( siteDetails.id, server );
			server.details = siteDetails;

			if ( siteDetails.running ) {
				server.server = new CliServerProcess(
					siteDetails.id,
					siteDetails.path,
					( siteDetails as StartedSiteDetails ).url
				);
			}

			return { server, details: siteDetails };
		} finally {
			server.hasOngoingOperation = false;
		}
	}

	async delete() {
		const thumbnailPath = getSiteThumbnailPath( this.details.id );
		if ( fs.existsSync( thumbnailPath ) ) {
			await fs.promises.unlink( thumbnailPath );
		}

		// If we're using a custom domain, clean up the hosts file and unregister from proxy
		if ( this.details.customDomain ) {
			try {
				await removeDomainFromHosts( this.details.customDomain );
				console.log( `Domain ${ this.details.customDomain } unregistered from proxy server` );
			} catch ( error ) {
				console.error( 'Failed to clean up custom domain:', error );
			}
		}

		if ( this.details.customDomain && this.details.enableHttps ) {
			const certificateDeleted = deleteSiteCertificate( this.details.customDomain ?? '' );
			if ( certificateDeleted ) {
				console.log( `Certificates for ${ this.details.customDomain } have been deleted` );
			}
		}

		await this.stop();
		await this.wpCliExecutor?.stop();
		deletedServers.push( this.details.id );
		servers.delete( this.details.id );
		portFinder.releasePort( this.details.port );
	}

	async start() {
		if ( this.details.running || this.server || this.hasOngoingOperation ) {
			return;
		}

		const isPortAvailable = await portFinder.isPortAvailable( this.details.port );
		if ( ! isPortAvailable ) {
			throw new Error(
				`Port ${ this.details.port } is not available. error code: ERROR_PORT_IN_USE`
			);
		}

		this.hasOngoingOperation = true;
		try {
			console.log( `Starting server for '${ this.details.name }'` );
			const url = getAbsoluteUrl( this.details );
			this.server = new CliServerProcess( this.details.id, this.details.path, url );
			await this.server.start();

			const userData = await loadUserData();
			const freshSiteData = userData.sites.find( ( s ) => s.id === this.details.id );

			this.details = {
				...this.details,
				url,
				running: true,
				autoStart: true,
				latestCliPid: freshSiteData?.latestCliPid,
			};
		} finally {
			this.hasOngoingOperation = false;
		}
	}

	async updateSiteDetails( site: SiteDetails ) {
		const oldDomain = this.details.customDomain;
		const newDomain = site.customDomain;
		const oldEnableHttps = this.details.enableHttps;
		const newEnableHttps = site.enableHttps;

		this.details = {
			...this.details,
			name: site.name,
			path: site.path,
			phpVersion: site.phpVersion,
			isWpAutoUpdating: site.isWpAutoUpdating,
			customDomain: site.customDomain,
			enableHttps: site.enableHttps,
		};

		if ( this.server && this.details.running ) {
			this.details.url = getAbsoluteUrl( this.details );
			this.server.url = this.details.url;
		}

		// Handle domain changes and url changes (updates hosts and database)
		if ( oldDomain !== newDomain ) {
			void updateDomainInHosts( oldDomain, newDomain, this.details.port );
		}
		if ( ( oldDomain && ! newDomain ) || oldEnableHttps !== newEnableHttps ) {
			await updateSiteUrl( this, getSiteUrl( this.details ) );
		}

		if (
			oldDomain &&
			oldEnableHttps &&
			( oldDomain !== newDomain || oldEnableHttps !== newEnableHttps )
		) {
			deleteSiteCertificate( oldDomain );
		}
		if (
			newDomain &&
			newEnableHttps &&
			( oldDomain !== newDomain || oldEnableHttps !== newEnableHttps )
		) {
			const { cert, key } = await generateSiteCertificate( newDomain );
			this.details = {
				...this.details,
				tlsKey: key,
				tlsCert: cert,
			};
		}
	}

	async stop() {
		console.log( 'Stopping server with ID', this.details.id );
		try {
			this.hasOngoingOperation = true;
			await this.server?.stop();
			this.server = undefined;

			if ( ! this.details.running ) {
				console.log( 'Server is not running' );
				return;
			}

			const { running, autoStart, url, ...rest } = this.details;
			this.details = { running: false, autoStart: false, ...rest };
		} catch ( error ) {
			console.error( error );
		} finally {
			this.hasOngoingOperation = false;
		}
	}

	async updateCachedThumbnail() {
		if ( ! this.details.running ) {
			console.warn( `Thumbnail update skipped: server ${ this.details.id } is not running.` );
			return;
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
			.catch( async ( error ) => {
				Sentry.captureException( error );
				try {
					await fs.promises.unlink( outPath );
				} catch ( unlinkError ) {
					// Ignore ENOENT errors as the file might not exist
					if ( ( unlinkError as NodeJS.ErrnoException ).code !== 'ENOENT' ) {
						console.error( 'Failed to cleanup thumbnail file:', unlinkError );
					}
				}
			} )
			.finally( () => window.destroy() );
	}

	async executeWpCliCommand(
		args: string,
		{
			targetPhpVersion,
			skipPluginsAndThemes = false,
		}: {
			targetPhpVersion?: string;
			skipPluginsAndThemes?: boolean;
		} = {}
	): Promise< WpCliResult > {
		const projectPath = this.details.path;
		const phpVersion = targetPhpVersion ?? this.details.phpVersion;

		if ( ! this.wpCliExecutor ) {
			this.wpCliExecutor = new WpCliProcess( projectPath );
			await this.wpCliExecutor.init();
		}

		const wpCliArgs = parse( args );

		if ( skipPluginsAndThemes ) {
			wpCliArgs.push( '--skip-plugins' );
			wpCliArgs.push( '--skip-themes' );
		}

		// The parsing of arguments can include shell operators like `>` or `||` that the app don't support.
		const isValidCommand = wpCliArgs.every(
			( arg: unknown ) => typeof arg === 'string' || arg instanceof String
		);
		if ( ! isValidCommand ) {
			throw Error( `Cannot execute wp-cli command with arguments: ${ args }` );
		}

		try {
			return await this.wpCliExecutor.execute( wpCliArgs as string[], { phpVersion } );
		} catch ( error ) {
			if ( ( error as MessageCanceled )?.canceled ) {
				return {
					stdout: '',
					stderr: 'WP-CLI command was canceled (timed out)',
					exitCode: 1,
				};
			}

			Sentry.captureException( error );
			return {
				stdout: '',
				stderr: `Error executing WP-CLI command: ${ ( error as MessageCanceled ).error.message }`,
				exitCode: 1,
			};
		}
	}

	async hasSQLitePlugin(): Promise< boolean > {
		const wpContentPath = nodePath.join( this.details.path, 'wp-content' );
		const sqliteFilename = getWordPressProvider().SQLITE_FILENAME;

		const sqliteIntegrationPaths = {
			muPlugin: nodePath.join( wpContentPath, 'mu-plugins', sqliteFilename ),
			muPluginLegacy: nodePath.join( wpContentPath, 'mu-plugins', `${ sqliteFilename }-main` ),
			regularPlugin: nodePath.join( wpContentPath, 'plugins', sqliteFilename ),
		};

		const requiredConfigPaths = {
			wpConfig: nodePath.join( this.details.path, 'wp-config.php' ),
			dbConfig: nodePath.join( wpContentPath, 'db.php' ),
			dbSqlite: nodePath.join( wpContentPath, 'database', '.ht.sqlite' ),
		};

		const anyIntegrationExists = await Promise.all( [
			fsExtra.pathExists( sqliteIntegrationPaths.muPlugin ),
			fsExtra.pathExists( sqliteIntegrationPaths.muPluginLegacy ),
			fsExtra.pathExists( sqliteIntegrationPaths.regularPlugin ),
		] ).then( ( results ) => results.some( Boolean ) );

		const configFilesExist = await Promise.all( [
			fsExtra.pathExists( requiredConfigPaths.wpConfig ),
			fsExtra.pathExists( requiredConfigPaths.dbConfig ),
			fsExtra.pathExists( requiredConfigPaths.dbSqlite ),
		] ).then( ( results ) => results.every( Boolean ) );

		return anyIntegrationExists && configFilesExist;
	}
}
