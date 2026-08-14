import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { SQLITE_FILENAME } from '@studio/common/constants';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import { SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { listSites } from '@studio/common/sites/list';
import fsExtra from 'fs-extra';
import { parse } from 'shell-quote';
import { z } from 'zod';
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
 * @param timeoutAfterMs Optional timeout in milliseconds.
 */
export async function stopAllServers( timeoutAfterMs?: number ) {
	let timeoutId: NodeJS.Timeout | undefined;

	return new Promise< void >( ( resolve ) => {
		const args = [ 'site', 'stop', '--all' ];
		const [ emitter, childProcess ] = executeCliCommand( args, { output: 'ignore' } );
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', () => resolve() );
		emitter.on( 'error', () => resolve() );

		if ( timeoutAfterMs ) {
			timeoutId = setTimeout( () => {
				console.warn(
					`site stop --all command timed out after ${ timeoutAfterMs }ms. Killing process.`
				);
				childProcess.kill( 'SIGKILL' );
				resolve();
			}, timeoutAfterMs );
		}
	} ).finally( () => {
		if ( timeoutId ) {
			clearTimeout( timeoutId );
		}
	} );
}

export function getRunningSiteCount(): number {
	return Array.from( servers.values() ).filter( ( server ) => server.details.running ).length;
}

// Re-query the CLI for authoritative running state and reconcile in-memory details — recovers from
// transitions the `_events` stream never emits (e.g. a daemon crash), which no push update can fix.
export async function reconcileSitesRunningState(): Promise< void > {
	let cliSites;
	try {
		cliSites = await listSites( executeCliCommand );
	} catch ( error ) {
		console.error( 'Failed to reconcile site running state:', error );
		return;
	}

	const runningById = new Map( cliSites.map( ( site ) => [ site.id, site.running ] ) );
	for ( const server of SiteServer.getAll() ) {
		const actualRunning = runningById.get( server.details.id );
		if ( actualRunning === undefined ) {
			continue;
		}
		server.adoptRunningState( actualRunning );
	}
}

// Persist autoStart for every currently-running site in a single locked write. Used on quit, where the
// CLI events subscriber (which normally mirrors autoStart into app.json) has already been stopped.
export async function persistAutoStartForRunningSites( autoStart: boolean ): Promise< void > {
	const runningServers = Array.from( servers.values() ).filter(
		( server ) => server.details.running
	);
	if ( ! runningServers.length ) {
		return;
	}
	try {
		await lockAppdata();
		const userData = await loadUserData();
		for ( const server of runningServers ) {
			const siteId = server.details.id;
			userData.siteMetadata[ siteId ] = {
				...userData.siteMetadata[ siteId ],
				autoStart,
			};
			server.details.autoStart = autoStart;
		}
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
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

	// True while Studio serves a PHP-error page for this site and watches for a fix. The CLI reports
	// the site as stopped in this state, so running-state adoption treats it as running instead.
	inErrorRecovery = false;

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

	static getAll(): SiteServer[] {
		return Array.from( servers.values() );
	}

	static getAllDetails(): SiteDetails[] {
		return Array.from( servers.values() ).map( ( server ) => server.details );
	}

	static isDeleted( id: string ) {
		return deletedServers.includes( id );
	}

	static async fetchAll(): Promise< void > {
		try {
			// Same shared site-listing the `studio ui` server uses; it forks the CLI
			// through the desktop's `executeCliCommand` so existing mocks still apply.
			const sites = await listSites( executeCliCommand );

			for ( const site of sites ) {
				if ( ! SiteServer.get( site.id ) ) {
					SiteServer.register( site );
				}
			}
		} catch ( error ) {
			console.error( 'Failed to fetch sites from CLI:', error );
		}
	}

	static register( details: SiteDetails, meta: SiteServerMeta = {} ): SiteServer {
		const server = new SiteServer( details, meta );
		servers.set( details.id, server );
		return server;
	}

	static async unregister( id: string ): Promise< void > {
		deletedServers.push( id );
		servers.delete( id );
		await SiteServer.deleteSiteMetadata( id );
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

		// Default to the native PHP runtime when the caller doesn't specify one.
		const runtime = options.runtime ?? SITE_RUNTIME_NATIVE_PHP;
		let result;
		try {
			result = await createSiteViaCli( { ...options, runtime, siteId } );
		} catch ( error ) {
			// Not `unregister`, which would mark the id deleted; this site never existed.
			servers.delete( siteId );
			throw error;
		}
		server.details.runtime = runtime;
		server.details.fileAccess = options.fileAccess;

		server.details.port = result.port;
		if ( result.running ) {
			const url = getAbsoluteUrl( server.details );
			const startedDetails: StartedSiteDetails = {
				...server.details,
				running: true,
				url,
			};
			server.details = startedDetails;
			server.server.url = url;
		}

		return { server, details: server.details };
	}

	async delete( deleteFiles: boolean ) {
		const thumbnailPath = getSiteThumbnailPath( this.details.id );
		if ( fs.existsSync( thumbnailPath ) ) {
			await fs.promises.unlink( thumbnailPath );
		}

		await this.server.delete( deleteFiles );
		deletedServers.push( this.details.id );
		servers.delete( this.details.id );
		await SiteServer.deleteSiteMetadata( this.details.id );
	}

	private static async deleteSiteMetadata( id: string ) {
		try {
			await lockAppdata();
			const userData = await loadUserData();
			if ( userData.siteMetadata[ id ] ) {
				delete userData.siteMetadata[ id ];
				await saveUserData( userData );
			}
		} finally {
			await unlockAppdata();
		}
	}

	async start() {
		if ( this.details.running ) {
			return;
		}

		console.log( `Starting server for '${ this.details.name }'` );
		await this.server.start();
	}

	// Adopt an authoritative running value, touching only running/url so Studio-owned fields survive.
	adoptRunningState( running: boolean ): boolean {
		// A site serving a PHP-error page counts as running even though the CLI reports it stopped.
		if ( this.inErrorRecovery ) {
			running = true;
		}

		if ( this.details.running === running ) {
			return false;
		}

		if ( running ) {
			const url = getAbsoluteUrl( this.details );
			this.details = { ...this.details, running: true, url };
			this.server.url = url;
		} else {
			const { running: _wasRunning, ...rest } = this.details;
			if ( 'url' in rest ) {
				const { url: _url, ...stoppedRest } = rest;
				this.details = { running: false, ...stoppedRest };
			} else {
				this.details = { running: false, ...rest };
			}
		}
		return true;
	}

	updateSiteDetails( site: SiteDetails ) {
		this.details = {
			...this.details,
			name: site.name,
			path: site.path,
			phpVersion: site.phpVersion,
			runtime: site.runtime,
			fileAccess: site.fileAccess,
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
		} catch ( error ) {
			console.error( error );
		}

		const { running, ...rest } = this.details;
		if ( 'url' in rest ) {
			const { url, ...stoppedRest } = rest;
			this.details = { running: false, ...stoppedRest };
		} else {
			this.details = { running: false, ...rest };
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
			.catch( async () => {
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

			emitter.on( 'failure', ( { error, result } ) => {
				resolve( {
					stdout: result.stdout,
					stderr: result.stderr || error.lastErrorMessage || '',
					exitCode: 1,
				} );
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

			const themeDetailsParsed = parseJsonFromPhpOutput( stdout );
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
			const siteId = this.details.id;
			userData.siteMetadata[ siteId ] = {
				...userData.siteMetadata[ siteId ],
				themeDetails: this.details.themeDetails,
			};
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	}

	private static siteIconSchema = z.object( {
		relativePath: z.string(),
	} );

	async getSiteIcon(): Promise< SiteDetails[ 'siteIconPath' ] > {
		if ( ! this.details.running ) {
			return this.details.siteIconPath;
		}

		try {
			const { stdout, stderr, exitCode } = await this.executeWpCliCommand( [
				'studio',
				'get-site-icon',
			] );

			if ( exitCode !== 0 ) {
				console.error( 'Failed to get site icon via WP-CLI', { exitCode, stdout, stderr } );
				return this.details.siteIconPath;
			}

			const parsed = parseJsonFromPhpOutput( stdout );
			if ( parsed === null ) {
				this.details.siteIconPath = null;
			} else {
				const { relativePath } = SiteServer.siteIconSchema.parse( parsed );
				this.details.siteIconPath = nodePath.join( this.details.path, relativePath );
			}
		} catch ( error ) {
			console.error( 'Failed to get site icon:', error );
		}

		return this.details.siteIconPath;
	}

	async persistSiteIcon(): Promise< void > {
		try {
			await lockAppdata();
			const userData = await loadUserData();
			const siteId = this.details.id;
			userData.siteMetadata[ siteId ] = {
				...userData.siteMetadata[ siteId ],
				siteIconPath: this.details.siteIconPath,
			};
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	}

	async persistAutoStart( autoStart: boolean ): Promise< void > {
		this.details.autoStart = autoStart;
		try {
			await lockAppdata();
			const userData = await loadUserData();
			const siteId = this.details.id;
			userData.siteMetadata[ siteId ] = {
				...userData.siteMetadata[ siteId ],
				autoStart,
			};
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
