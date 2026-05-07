import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { format } from 'node:util';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { writeStudioMuPluginsForNativePhpRuntime } from '@studio/common/lib/mu-plugins';
import { decodePassword } from '@studio/common/lib/passwords';
import {
	NativePhpSupportedVersion,
	validateNativePhpVersion,
} from '@studio/common/lib/php-binary-metadata';
import {
	getBlueprintsPharPath,
	getPhpBinaryPath,
	getWpCliPharPath,
} from 'cli/lib/dependency-management/paths';
import { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

const CLI_ROOT =
	path.basename( import.meta.dirname ) === 'lib'
		? path.resolve( import.meta.dirname, '..' )
		: import.meta.dirname;
const ROUTER_PATH = path.resolve( CLI_ROOT, 'php', 'router.php' );
const SET_DEFAULT_PERMALINKS_PATH = path.resolve( CLI_ROOT, 'php', 'set-default-permalinks.php' );
const WP_CONFIG_TRANSFORMER_PATH = path.resolve( CLI_ROOT, 'php', 'wp-config-transformer.php' );
const DEFAULT_WP_CONFIG_CONSTANTS = { DB_NAME: 'wordpress' } as const;

type SpawnPhpProcessOptions = {
	phpVersion: NativePhpSupportedVersion;
	cwd?: string;
	signal?: AbortSignal;
	mode?: 'pipe' | 'capture-stdout';
	opcacheSiteId?: string;
};

type RunPhpCommandOptions = SpawnPhpProcessOptions;

type NativePhpRuntimeEvents = {
	onActivity?: () => void;
	onStdoutLine?: ( line: string ) => void;
	onStderrLine?: ( line: string ) => void;
	onPhpProcessSpawn?: ( child: ChildProcess ) => void;
};

// Process-scoped opcache dir, created lazily and removed when the daemon exits.
// Scoping to the daemon process means we never need cleanup logic for stale
// caches; the trade-off is a cold compile on the first request after each
// daemon launch.
let opcacheRootDir: string | null = null;

function getOpcacheRootDir(): string {
	if ( opcacheRootDir ) {
		return opcacheRootDir;
	}

	// Resolve to the long-form path on Windows. `os.tmpdir()` can return an 8.3
	// short name (e.g. C:\Users\BUILDK~1\AppData\…) when the user has a long
	// username, and PHP's INI scanner treats `~` as a special token, breaking
	// `-d opcache.file_cache=<path>` parsing.
	const tmpRoot =
		process.platform === 'win32' ? fs.realpathSync.native( os.tmpdir() ) : os.tmpdir();
	opcacheRootDir = fs.mkdtempSync( path.join( tmpRoot, 'studio-opcache-' ) );
	const dirToClean = opcacheRootDir;
	process.once( 'exit', () => {
		try {
			fs.rmSync( dirToClean, { recursive: true, force: true } );
		} catch {
			// Best effort. The OS will reap tmp eventually.
		}
	} );
	return opcacheRootDir;
}

function getDefaultPhpArgs( phpVersion: NativePhpSupportedVersion, siteId?: string ): string[] {
	if ( process.platform !== 'win32' || ! siteId ) {
		return [];
	}

	// Partition the file_cache by PHP version: opcache's on-disk script blob
	// format isn't stable across minor versions, and reusing a cache populated
	// by a different PHP can crash the server at startup on Windows.
	const cacheId = `${ siteId.replace( /[^A-Za-z0-9_.-]/g, '-' ) }-php${ phpVersion }`;
	const cacheDirectory = path.join( getOpcacheRootDir(), cacheId );
	fs.mkdirSync( cacheDirectory, { recursive: true } );

	// Quote the INI values so PHP's INI scanner takes them literally — paths
	// with characters like `~`, `;`, `#` or `=` are otherwise treated as INI
	// syntax and break parsing.
	return [
		'-d',
		`opcache.file_cache="${ cacheDirectory }"`,
		'-d',
		'opcache.file_cache_fallback=1',
		'-d',
		`opcache.cache_id="studio-${ cacheId }"`,
	];
}

function splitLogMessage( message: string ): string[] {
	return message.split( /\r?\n/ );
}

export class NativePhpRuntime {
	private blueprintQueue: Promise< unknown > = Promise.resolve();

	constructor( private readonly events: NativePhpRuntimeEvents = {} ) {}

	private logToConsole( ...args: Parameters< typeof console.log > ) {
		this.emitFormattedLine( 'stdout', '[PHP Server]', ...args );
	}

	private errorToConsole( ...args: Parameters< typeof console.error > ) {
		this.emitFormattedLine( 'stderr', '[PHP Server]', ...args );
	}

	private emitFormattedLine(
		target: 'stdout' | 'stderr',
		prefix: string,
		...args: unknown[]
	): void {
		const emit = target === 'stdout' ? this.events.onStdoutLine : this.events.onStderrLine;
		if ( ! emit ) {
			return;
		}

		for ( const line of splitLogMessage( `${ prefix } ${ format( ...args ) }` ) ) {
			emit( line );
		}
	}

	private reportActivity(): void {
		this.events.onActivity?.();
	}

	private spawnPhpProcess(
		args: string[],
		{ phpVersion, cwd, signal, mode = 'pipe', opcacheSiteId }: SpawnPhpProcessOptions
	): ChildProcess {
		const defaultArgs = getDefaultPhpArgs( phpVersion, opcacheSiteId );
		console.log( 'default php args', defaultArgs );
		const phpArgs = [ ...defaultArgs, ...args ];
		const phpScriptProcess = spawn( getPhpBinaryPath( phpVersion ), phpArgs, {
			cwd,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			signal,
			windowsHide: true,
		} );

		this.events.onPhpProcessSpawn?.( phpScriptProcess );

		phpScriptProcess.stdout?.on( 'data', () => {
			this.reportActivity();
		} );
		phpScriptProcess.stderr?.on( 'data', () => {
			this.reportActivity();
		} );

		if ( mode === 'pipe' && phpScriptProcess.stdout ) {
			const stdoutReader = readline.createInterface( {
				input: phpScriptProcess.stdout,
				crlfDelay: Infinity,
			} );
			stdoutReader.on( 'line', ( line ) => {
				this.events.onStdoutLine?.( line );
			} );
		}

		if ( ( mode === 'pipe' || mode === 'capture-stdout' ) && phpScriptProcess.stderr ) {
			const stderrReader = readline.createInterface( {
				input: phpScriptProcess.stderr,
				crlfDelay: Infinity,
			} );
			stderrReader.on( 'line', ( line ) => {
				this.events.onStderrLine?.( line );
			} );
		}

		return phpScriptProcess;
	}

	private async runPhpCommand(
		args: string[],
		{ phpVersion, cwd, signal, mode = 'pipe', opcacheSiteId }: RunPhpCommandOptions
	): Promise< { stdout: string } > {
		return await new Promise< { stdout: string } >( ( resolve, reject ) => {
			const phpScriptProcess = this.spawnPhpProcess( args, {
				phpVersion,
				cwd,
				signal,
				mode,
				opcacheSiteId,
			} );

			let stdout = '';
			phpScriptProcess.stdout?.on( 'data', ( chunk ) => {
				if ( mode === 'capture-stdout' ) {
					stdout += chunk.toString();
				}
			} );

			phpScriptProcess.once( 'error', ( error: Error ) => {
				reject( error );
			} );
			phpScriptProcess.once( 'close', ( code ) => {
				if ( code === 0 ) {
					resolve( { stdout } );
					return;
				}

				reject( new Error( `PHP command failed (code: ${ code })` ) );
			} );
		} );
	}

	private async ensureWpConfig(
		siteFolder: string,
		phpVersion: NativePhpSupportedVersion,
		signal: AbortSignal,
		config?: Pick< ServerConfig, 'enableDebugLog' | 'enableDebugDisplay' >
	): Promise< void > {
		const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
		const wpConfigSamplePath = path.join( siteFolder, 'wp-config-sample.php' );
		const ensureWpConfigScript = `
$transformer_path = $argv[1] ?? '';
$wp_config_path = $argv[2] ?? '';
$constants = json_decode( $argv[3] ?? '', true );

require_once $transformer_path;

$transformer = WP_Config_Transformer::from_file( $wp_config_path );
$transformer->define_constants( $constants );
$transformer->to_file( $wp_config_path );
`;

		if ( ! fs.existsSync( wpConfigPath ) && fs.existsSync( wpConfigSamplePath ) ) {
			await fs.promises.copyFile( wpConfigSamplePath, wpConfigPath );
		}

		const enableDebugLog = config?.enableDebugLog ?? false;
		const enableDebugDisplay = config?.enableDebugDisplay ?? false;
		const constants = {
			...DEFAULT_WP_CONFIG_CONSTANTS,
			WP_DEBUG: enableDebugLog || enableDebugDisplay,
			WP_DEBUG_LOG: enableDebugLog,
			WP_DEBUG_DISPLAY: enableDebugDisplay,
		};

		try {
			await this.runPhpCommand(
				[
					'-r',
					ensureWpConfigScript,
					WP_CONFIG_TRANSFORMER_PATH,
					wpConfigPath,
					JSON.stringify( constants ),
				],
				{ phpVersion, signal }
			);
		} catch ( error ) {
			throw new Error(
				`Failed to ensure wp-config.php constants: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}

	private async isWordPressInstalled(
		siteFolder: string,
		phpVersion: NativePhpSupportedVersion,
		signal: AbortSignal
	): Promise< boolean > {
		const installationCheckScript = `
error_reporting( E_ERROR );
ini_set( 'display_errors', '0' );

$wp_load = getcwd() . '/wp-load.php';
if ( ! file_exists( $wp_load ) ) {
	echo '0';
	exit( 0 );
}
require_once $wp_load;
echo is_blog_installed() ? '1' : '0';
`;

		let stdout = '';
		try {
			const result = await this.runPhpCommand( [ '-r', installationCheckScript ], {
				phpVersion,
				cwd: siteFolder,
				signal,
				mode: 'capture-stdout',
			} );
			stdout = result.stdout;
		} catch ( error ) {
			throw new Error(
				`Failed to check WordPress installation status: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}

		const status = stdout.trim();
		return status === '1';
	}

	private async waitForServerReady( url: string, signal: AbortSignal ): Promise< void > {
		const pollIntervalMs = 50;
		const timeoutMs = 30_000;
		const deadline = Date.now() + timeoutMs;

		while ( true ) {
			signal.throwIfAborted();
			try {
				await fetch( url, { signal } );
				return;
			} catch {
				signal.throwIfAborted();
				if ( Date.now() > deadline ) {
					throw new Error( `PHP server did not start within ${ timeoutMs }ms` );
				}
				await new Promise< void >( ( resolve ) => setTimeout( resolve, pollIntervalMs ) );
			}
		}
	}

	private async installWordPress(
		config: ServerConfig,
		phpVersion: NativePhpSupportedVersion,
		signal: AbortSignal
	): Promise< void > {
		const alreadyInstalled = await this.isWordPressInstalled( config.sitePath, phpVersion, signal );
		if ( alreadyInstalled ) {
			this.logToConsole(
				`WordPress already installed for site ${ config.siteId }; skipping installer`
			);
			return;
		}

		const siteTitle = config.siteTitle ?? 'My WordPress Website';
		const username = config.adminUsername ?? 'admin';
		const password = config.adminPassword ? decodePassword( config.adminPassword ) : 'password';
		const email = config.adminEmail ?? 'admin@localhost.com';
		const siteUrl = config.absoluteUrl ?? `http://localhost:${ config.port }`;
		const locale =
			config.siteLanguage && config.siteLanguage !== DEFAULT_LOCALE
				? config.siteLanguage
				: undefined;

		await this.runPhpCommand(
			[
				getWpCliPharPath(),
				'core',
				'install',
				`--path=${ config.sitePath }`,
				`--url=${ siteUrl }`,
				`--title=${ siteTitle }`,
				`--admin_user=${ username }`,
				`--admin_password=${ password }`,
				`--admin_email=${ email }`,
				...( locale ? [ `--locale=${ locale }` ] : [] ),
				'--skip-email',
			],
			{ phpVersion, signal }
		);

		await this.runPhpCommand(
			[
				getWpCliPharPath(),
				'option',
				'update',
				'studio_admin_username',
				username,
				`--path=${ config.sitePath }`,
			],
			{ phpVersion, signal }
		);

		try {
			await this.runPhpCommand( [ SET_DEFAULT_PERMALINKS_PATH ], {
				phpVersion,
				cwd: config.sitePath,
				signal,
			} );
		} catch ( error ) {
			throw new Error(
				`Failed to set default permalinks: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}

	private async waitForSpawn( child: ChildProcess, signal: AbortSignal ): Promise< void > {
		let onSpawn: () => void;
		let onError: ( error: Error ) => void;
		let onAbort: () => void;

		await new Promise< void >( ( resolve, reject ) => {
			onSpawn = () => resolve();
			onError = ( error: Error ) => reject( error );
			onAbort = () => reject( new DOMException( 'Aborted', 'AbortError' ) );

			child.once( 'spawn', onSpawn );
			child.once( 'error', onError );
			signal.addEventListener( 'abort', onAbort, { once: true } );
		} ).finally( () => {
			child.off( 'spawn', onSpawn );
			child.off( 'error', onError );
			signal.removeEventListener( 'abort', onAbort );
		} );
	}

	async startServer( config: ServerConfig, signal: AbortSignal ): Promise< ChildProcess > {
		const phpVersion = validateNativePhpVersion( config.phpVersion ?? '' );

		try {
			signal.throwIfAborted();
			await this.prepareWordPress( config, phpVersion, signal );
			signal.throwIfAborted();

			if ( config.blueprint ) {
				await this.applyBlueprint( config, config.blueprint, phpVersion, signal );
				signal.throwIfAborted();
			}

			const phpAddress = `localhost:${ config.port }`;
			this.logToConsole(
				`Spawning PHP built-in server on ${ phpAddress } for site ${ config.siteId }`
			);

			const spawnedServerChild = this.spawnPhpProcess( [ '-S', phpAddress, ROUTER_PATH ], {
				phpVersion,
				cwd: config.sitePath,
				opcacheSiteId: config.siteId,
			} );

			await this.waitForSpawn( spawnedServerChild, signal );

			// Capture stderr during startup so any fatal startup error from PHP
			// (e.g. "Failed to listen on …: Address already in use") is included
			// in the rejection rather than swallowed.
			const startupStderrChunks: string[] = [];
			const startupStderrHandler = ( chunk: Buffer ) => {
				startupStderrChunks.push( chunk.toString( 'utf8' ) );
			};
			spawnedServerChild.stderr?.on( 'data', startupStderrHandler );

			let startupExitHandler:
				| ( ( code: number | null, signal: NodeJS.Signals | null ) => void )
				| null = null;
			const startupExitPromise = new Promise< never >( ( _, reject ) => {
				startupExitHandler = ( code, exitSignal ) => {
					// `exit` can fire before readline has flushed the final stderr lines on
					// Windows, so wait briefly for the stream to drain before rejecting.
					const drainTimeoutMs = 300;
					const drainDeadline = setTimeout( () => finalize(), drainTimeoutMs );
					const finalize = () => {
						clearTimeout( drainDeadline );
						spawnedServerChild.stderr?.off( 'end', finalize );
						const tail = startupStderrChunks.join( '' ).trim();
						const detail = tail ? `\n${ tail }` : '';
						reject(
							new Error(
								`PHP child process exited before startup completed (code=${ code }, signal=${ exitSignal })${ detail }`
							)
						);
					};
					spawnedServerChild.stderr?.once( 'end', finalize );
				};
				spawnedServerChild.once( 'exit', startupExitHandler );
			} );

			signal.throwIfAborted();

			await Promise.race( [
				this.waitForServerReady( `http://localhost:${ config.port }/`, signal ),
				startupExitPromise,
			] ).finally( () => {
				spawnedServerChild.stderr?.off( 'data', startupStderrHandler );
				if ( startupExitHandler ) {
					spawnedServerChild.off( 'exit', startupExitHandler );
				}
			} );

			return spawnedServerChild;
		} catch ( error ) {
			if ( signal.aborted ) {
				this.logToConsole( 'Aborted start server operation:', error );
			} else {
				this.errorToConsole( 'Failed to start server:', error );
			}

			throw error;
		}
	}

	async runBlueprint( config: ServerConfig, signal: AbortSignal ): Promise< void > {
		const phpVersion = validateNativePhpVersion( config.phpVersion ?? '' );
		await this.prepareWordPress( config, phpVersion, signal );
		if ( ! config.blueprint ) {
			throw new Error( 'Blueprint is required' );
		}
		const blueprint = config.blueprint;

		const next = this.blueprintQueue
			.catch( () => {} )
			.then( () => this.applyBlueprint( config, blueprint, phpVersion, signal ) );
		this.blueprintQueue = next;
		await next;
	}

	private async prepareWordPress(
		config: ServerConfig,
		phpVersion: NativePhpSupportedVersion,
		signal: AbortSignal
	): Promise< void > {
		await this.ensureWpConfig( config.sitePath, phpVersion, signal, config );
		signal.throwIfAborted();
		await writeStudioMuPluginsForNativePhpRuntime( config.sitePath, config.isWpAutoUpdating );
		signal.throwIfAborted();
		await this.installWordPress( config, phpVersion, signal );
		signal.throwIfAborted();
	}

	private async applyBlueprint(
		config: ServerConfig,
		blueprint: NonNullable< ServerConfig[ 'blueprint' ] >,
		phpVersion: NativePhpSupportedVersion,
		signal: AbortSignal
	): Promise< void > {
		if ( blueprint.uri.startsWith( 'http://' ) || blueprint.uri.startsWith( 'https://' ) ) {
			throw new Error(
				`Remote blueprint URIs are not supported by the native PHP runtime: ${ blueprint.uri }`
			);
		}

		const enableDebugLog = config.enableDebugLog ?? false;
		const enableDebugDisplay = config.enableDebugDisplay ?? false;
		const defaultConstants: Record< string, boolean | string > = {
			DB_NAME: 'wordpress',
			WP_DEBUG: enableDebugLog || enableDebugDisplay,
			WP_DEBUG_LOG: enableDebugLog,
			WP_DEBUG_DISPLAY: enableDebugDisplay,
		};

		const preferredVersions = {
			php: config.phpVersion || blueprint.contents?.preferredVersions?.php || DEFAULT_PHP_VERSION,
			wp: config.wpVersion || blueprint.contents?.preferredVersions?.wp || 'latest',
		};
		blueprint.contents.constants = {
			...blueprint.contents.constants,
			...defaultConstants,
		};
		blueprint.contents.preferredVersions = preferredVersions;

		const blueprintDir = path.dirname( blueprint.uri );
		const tmpPath = path.join( blueprintDir, `studio-blueprint-${ config.siteId }.json` );
		await fs.promises.writeFile( tmpPath, JSON.stringify( blueprint.contents ) );

		const muPluginsSqlite = path.join(
			config.sitePath,
			'wp-content',
			'mu-plugins',
			'sqlite-database-integration'
		);
		const pluginsSqlite = path.join(
			config.sitePath,
			'wp-content',
			'plugins',
			'sqlite-database-integration'
		);
		const needsSymlink = fs.existsSync( muPluginsSqlite ) && ! fs.existsSync( pluginsSqlite );
		let symlinkIno: number | undefined;
		if ( needsSymlink ) {
			fs.symlinkSync( muPluginsSqlite, pluginsSqlite, 'junction' );
			symlinkIno = fs.statSync( pluginsSqlite ).ino;
		}

		try {
			await this.runPhpCommand(
				[
					getBlueprintsPharPath(),
					'exec',
					tmpPath,
					'--mode=apply-to-existing-site',
					`--site-path=${ config.sitePath }`,
					`--site-url=${ config.absoluteUrl ?? `http://localhost:${ config.port }` }`,
					'--db-engine=sqlite',
				],
				{ phpVersion, signal }
			);
		} finally {
			await fs.promises.unlink( tmpPath ).catch( () => {} );
			if ( needsSymlink ) {
				try {
					if ( fs.statSync( pluginsSqlite ).ino === symlinkIno ) {
						await fs.promises.rm( pluginsSqlite, { recursive: true, force: true } );
					}
				} catch {
					// Best effort. Leaving the symlink behind is non-fatal.
				}
			}
		}
	}
}
