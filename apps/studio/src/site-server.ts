import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import fsExtra from 'fs-extra';
import { parse } from 'shell-quote';
import { z } from 'zod';
import { SQLITE_FILENAME } from '@studio/common/constants';
import {
	WP_CLI_DEFAULT_RESPONSE_TIMEOUT,
	WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT,
} from 'src/constants';
import { CliServerProcess } from 'src/modules/cli/lib/cli-server-process';
import { createSiteViaCli, type CreateSiteOptions } from 'src/modules/cli/lib/cli-site-creator';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { createScreenshotWindow } from 'src/screenshot-window';
import { getSiteThumbnailPath } from 'src/storage/paths';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export type WpCliResult = { stdout: string; stderr: string; exitCode: number };

const servers = new Map< string, SiteServer >();
const deletedServers: string[] = [];

/**
 * Stop all running sites using the CLI `site stop --all` command.
 *
 * @param shouldSaveAutoStartProp Makes it so sites are automatically started the next time Studio launches. Typically only true when this function runs during the application close sequence.
 */
export async function stopAllServers( shouldSaveAutoStartProp: boolean ) {
	return new Promise< void >( ( resolve ) => {
		const args = [ 'site', 'stop', '--all' ];
		if ( shouldSaveAutoStartProp ) {
			args.push( '--auto-start' );
		}
		const [ emitter ] = executeCliCommand( args );
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', () => resolve() );
		emitter.on( 'error', () => resolve() );
	} );
}

export function getRunningSiteCount(): number {
	return Array.from( servers.values() ).filter( ( server ) => server.details.running ).length;
}

// Only for testing purposes
export function __resetServersForTesting(): void {
	servers.clear();
	deletedServers.length = 0;
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
	server: CliServerProcess;

	/**
	 * Indicates whether a Studio-managed operation (start/stop) is in progress.
	 * When true, file watchers should ignore site events to prevent interference
	 * with the ongoing operation.
	 */
	hasOngoingOperation = false;

	private constructor(
		public details: SiteDetails,
		public meta: SiteServerMeta
	) {
		const url = getAbsoluteUrl( this.details );
		this.server = new CliServerProcess( this.details.id, this.details.path, url );
	}

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

	static register( details: SiteDetails, meta: SiteServerMeta = {} ): SiteServer {
		const server = new SiteServer( details, meta );
		servers.set( details.id, server );
		return server;
	}

	static unregister( id: string ): void {
		deletedServers.push( id );
		servers.delete( id );
	}

	static async create(
		options: CreateSiteOptions,
		meta: SiteServerMeta = {}
	): Promise< { server: SiteServer; details: SiteDetails } > {
		const siteId = options.siteId || crypto.randomUUID();
		const placeholderDetails: StoppedSiteDetails = {
			id: siteId,
			name: options.name || options.path,
			path: options.path,
			port: 0,
			phpVersion: options.phpVersion || '',
			running: false,
		};
		const server = SiteServer.register( placeholderDetails, meta );
		server.hasOngoingOperation = true;

		try {
			const result = await createSiteViaCli( { ...options, siteId } );
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

			if ( siteDetails.running && siteDetails.url ) {
				server.server.url = siteDetails.url;
			}

			return { server, details: siteDetails };
		} finally {
			server.hasOngoingOperation = false;
		}
	}

	async delete( deleteFiles: boolean ) {
		const thumbnailPath = getSiteThumbnailPath( this.details.id );
		if ( fs.existsSync( thumbnailPath ) ) {
			await fs.promises.unlink( thumbnailPath );
		}

		await this.server.delete( deleteFiles );
		deletedServers.push( this.details.id );
		servers.delete( this.details.id );
	}

	async start() {
		if ( this.details.running ) {
			return;
		}

		console.log( `Starting server for '${ this.details.name }'` );
		await this.server.start();

		const userData = await loadUserData();
		const freshSiteData = userData.sites.find( ( s ) => s.id === this.details.id );

		if ( freshSiteData?.port ) {
			this.details.port = freshSiteData.port;
		}

		const url = getAbsoluteUrl( this.details );

		this.details = {
			...this.details,
			url,
			running: true,
			autoStart: true,
			latestCliPid: freshSiteData?.latestCliPid,
		};

		this.server.url = url;
	}

	updateSiteDetails( site: SiteDetails ) {
		this.details = {
			...this.details,
			name: site.name,
			path: site.path,
			phpVersion: site.phpVersion,
			isWpAutoUpdating: site.isWpAutoUpdating,
			customDomain: site.customDomain,
			enableHttps: site.enableHttps,
			tlsKey: site.tlsKey,
			tlsCert: site.tlsCert,
			enableXdebug: site.enableXdebug,
		};

		if ( this.server && this.details.running ) {
			this.details.url = getAbsoluteUrl( this.details );
			this.server.url = this.details.url;
		}
	}

	async stop() {
		console.log( 'Stopping server with ID', this.details.id );
		try {
			await this.server.stop();

			if ( ! this.details.running ) {
				console.log( 'Server is not running' );
				return;
			}

			const { running, autoStart, url, ...rest } = this.details;
			this.details = { running: false, autoStart: false, ...rest };
		} catch ( error ) {
			console.error( error );
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

		let capturedImage: Electron.NativeImage | null = null;

		// Continue taking the screenshot asynchronously so we don't prevent the
		// UI from showing the server is now available.
		return fs.promises
			.mkdir( outDir, { recursive: true } )
			.then( waitForCapture )
			.then( ( image ) => {
				capturedImage = image;
				return fs.promises.writeFile( outPath, image.toPNG() );
			} )
			.catch( async ( error ) => {
				Sentry.captureException( error );
				if ( capturedImage ) {
					try {
						await fs.promises.unlink( outPath );
					} catch ( unlinkError ) {
						// Ignore ENOENT errors as the file might not exist
						if ( ( unlinkError as NodeJS.ErrnoException ).code !== 'ENOENT' ) {
							console.error( 'Failed to cleanup thumbnail file:', unlinkError );
						}
					}
				}
			} )
			.finally( () => window.destroy() );
	}

	async executeWpCliCommand(
		args: string | string[],
		{
			targetPhpVersion,
			skipPluginsAndThemes = false,
		}: {
			targetPhpVersion?: string;
			skipPluginsAndThemes?: boolean;
		} = {}
	): Promise< WpCliResult > {
		// If args is a string, parse it with shell-quote. If it's an array, use directly.
		let wpCliArgs: string[];
		if ( typeof args === 'string' ) {
			const parsedArgs = parse( args );

			// The parsing of arguments can include shell operators like `>` or `||` that the app don't support.
			const isValidCommand = parsedArgs.every(
				( arg: unknown ) => typeof arg === 'string' || arg instanceof String
			);
			if ( ! isValidCommand ) {
				return Promise.resolve( {
					stdout: '',
					stderr: `Cannot execute wp-cli command with arguments: ${ args }`,
					exitCode: 1,
				} );
			}
			wpCliArgs = parsedArgs as string[];
		} else {
			wpCliArgs = args;
		}

		const cliArgs: string[] = [ 'wp', '--path', this.details.path ];

		if ( targetPhpVersion ) {
			cliArgs.push( '--php-version', targetPhpVersion );
		}

		cliArgs.push( ...wpCliArgs );

		if ( skipPluginsAndThemes ) {
			cliArgs.push( '--skip-plugins', '--skip-themes' );
		}

		const isImportExport =
			wpCliArgs[ 0 ] === 'sqlite' && [ 'import', 'export' ].includes( wpCliArgs[ 1 ] );
		const timeout = isImportExport
			? WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT
			: WP_CLI_DEFAULT_RESPONSE_TIMEOUT;

		let timeoutId: NodeJS.Timeout;

		return new Promise< WpCliResult >( ( resolve ) => {
			const [ emitter, childProcess ] = executeCliCommand( cliArgs, {
				output: 'capture',
				logPrefix: this.details.id,
			} );

			timeoutId = setTimeout( () => {
				childProcess.kill();
				resolve( {
					stdout: '',
					stderr: `WP-CLI command timed out after ${ timeout }ms`,
					exitCode: 1,
				} );
			}, timeout );

			emitter.on( 'success', ( { result } ) => {
				resolve( { stdout: result.stdout, stderr: result.stderr, exitCode: 0 } );
			} );

			emitter.on( 'failure', ( { result } ) => {
				resolve( { stdout: result.stdout, stderr: result.stderr, exitCode: 1 } );
			} );

			emitter.on( 'error', ( { error } ) => {
				Sentry.captureException( error );
				resolve( {
					stdout: '',
					stderr: `Error executing WP-CLI command: ${ error.message }`,
					exitCode: 1,
				} );
			} );
		} ).finally( () => {
			clearTimeout( timeoutId );
		} );
	}

	private static themeDetailsSchema = z.object( {
		name: z.string().catch( '' ),
		path: z.string(),
		slug: z.string(),
		isBlockTheme: z.boolean(),
		supportsWidgets: z.boolean(),
		supportsMenus: z.boolean(),
	} );

	async getThemeDetails(): Promise< SiteDetails[ 'themeDetails' ] > {
		if ( ! this.details.running ) {
			return undefined;
		}

		try {
			const { stdout, stderr, exitCode } = await this.executeWpCliCommand( [
				'studio',
				'get-theme-details',
			] );

			if ( exitCode !== 0 || ! stdout ) {
				console.error( 'Failed to get theme details via WP-CLI', { exitCode, stdout, stderr } );
				return this.details.themeDetails;
			}

			const themeDetailsParsed = JSON.parse( stdout );
			this.details.themeDetails = SiteServer.themeDetailsSchema.parse( themeDetailsParsed );
		} catch ( error ) {
			console.error( 'Failed to get theme details:', error );
		}

		return this.details.themeDetails;
	}

	async persistThemeDetails(): Promise< void > {
		try {
			await lockAppdata();
			const userData = await loadUserData();
			const existingSite = userData.sites.find( ( site ) => site.id === this.details.id );
			if ( existingSite ) {
				existingSite.themeDetails = this.details.themeDetails;
			}
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	}

	async hasSQLitePlugin(): Promise< boolean > {
		const wpContentPath = nodePath.join( this.details.path, 'wp-content' );

		const sqliteIntegrationPaths = {
			muPlugin: nodePath.join( wpContentPath, 'mu-plugins', SQLITE_FILENAME ),
			muPluginLegacy: nodePath.join( wpContentPath, 'mu-plugins', `${ SQLITE_FILENAME }-main` ),
			regularPlugin: nodePath.join( wpContentPath, 'plugins', SQLITE_FILENAME ),
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
