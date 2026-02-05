/**
 * VIP Local Development Environment detection and management.
 *
 * This module reads VIP environment data directly from the filesystem
 * rather than parsing CLI output, providing a more reliable integration.
 */

import { spawn, exec } from 'child_process';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { homedir, platform } from 'os';
import path from 'path';
import { promisify } from 'util';
import type {
	VipCliStatus,
	VipCommandResult,
	VipCreateOptions,
	VipEnvironment,
	VipInstanceData,
	VipStartOptions,
} from '../types';

const execAsync = promisify( exec );

/**
 * Get the path to VIP's data directory.
 * Uses XDG_DATA_HOME on Linux/macOS, or LOCALAPPDATA on Windows.
 */
function getVipDataPath(): string {
	const os = platform();

	if ( os === 'win32' ) {
		const localAppData = process.env.LOCALAPPDATA || path.join( homedir(), 'AppData', 'Local' );
		return path.join( localAppData, 'vip' );
	}

	// Linux and macOS use XDG_DATA_HOME or default to ~/.local/share
	const xdgDataHome = process.env.XDG_DATA_HOME || path.join( homedir(), '.local', 'share' );
	return path.join( xdgDataHome, 'vip' );
}

/**
 * Get the path to VIP's dev-environment directory.
 */
export function getVipDevEnvPath(): string {
	return path.join( getVipDataPath(), 'dev-environment' );
}

/**
 * Extract PHP version from the full image tag.
 * @example "ghcr.io/automattic/vip-container-images/php-fpm:8.2" -> "8.2"
 */
function extractPhpVersion( phpImageTag: string ): string {
	const match = phpImageTag.match( /:(\d+\.\d+)/ );
	return match ? match[ 1 ] : phpImageTag;
}

/**
 * Read VIP instance data from a specific environment.
 */
async function readInstanceData( envPath: string ): Promise< VipInstanceData | null > {
	const instanceDataPath = path.join( envPath, 'instance_data.json' );

	try {
		const content = await fsPromises.readFile( instanceDataPath, 'utf-8' );
		return JSON.parse( content ) as VipInstanceData;
	} catch ( error ) {
		// Environment doesn't exist or has invalid data
		return null;
	}
}

/**
 * Check if a VIP environment is running by querying Docker.
 * VIP/Lando uses project names prefixed with "vipdev".
 */
export async function isVipEnvironmentRunning( slug: string ): Promise< boolean > {
	try {
		const { stdout } = await execAsync(
			`docker ps --filter "label=com.docker.compose.project=vipdev${ slug }" --format "{{.ID}}"`,
			{ timeout: 5000 }
		);
		return stdout.trim().length > 0;
	} catch {
		// Docker not running or command failed
		return false;
	}
}

/**
 * Get URLs for a running VIP environment by querying Docker labels.
 */
async function getVipEnvironmentUrls( slug: string ): Promise< string[] > {
	try {
		// Get the nginx container's labels which contain the Traefik routing info
		const { stdout } = await execAsync(
			`docker ps --filter "label=com.docker.compose.project=vipdev${ slug }" --filter "label=com.docker.compose.service=nginx" --format "{{.ID}}"`,
			{ timeout: 5000 }
		);

		const containerId = stdout.trim();
		if ( ! containerId ) {
			return [];
		}

		// The default URL pattern for VIP dev environments
		return [ `http://${ slug }.vipdev.lndo.site/` ];
	} catch {
		return [];
	}
}

/**
 * List all VIP environments.
 */
export async function listVipEnvironments(): Promise< VipEnvironment[] > {
	const devEnvPath = getVipDevEnvPath();

	// Check if the dev-environment directory exists
	if ( ! fs.existsSync( devEnvPath ) ) {
		return [];
	}

	const entries = await fsPromises.readdir( devEnvPath, { withFileTypes: true } );
	const environments: VipEnvironment[] = [];

	for ( const entry of entries ) {
		if ( ! entry.isDirectory() ) {
			continue;
		}

		const slug = entry.name;
		const envPath = path.join( devEnvPath, slug );

		const instanceData = await readInstanceData( envPath );
		if ( ! instanceData ) {
			continue;
		}

		// Check if running and get URLs

		const running = await isVipEnvironmentRunning( slug );

		const urls = running ? await getVipEnvironmentUrls( slug ) : [];

		environments.push( {
			slug,
			title: instanceData.wpTitle,
			running,
			phpVersion: extractPhpVersion( instanceData.php ),
			wordpressVersion: instanceData.wordpress.tag,
			multisite: instanceData.multisite,
			elasticsearch: Boolean( instanceData.elasticsearch ),
			phpmyadmin: instanceData.phpmyadmin,
			xdebug: instanceData.xdebug,
			mailpit: instanceData.mailpit,
			path: envPath,
			urls,
			appCodePath: instanceData.appCode.mode === 'local' ? instanceData.appCode.dir : undefined,
			muPluginsPath:
				instanceData.muPlugins.mode === 'local' ? instanceData.muPlugins.dir : undefined,
			autologinKey: instanceData.autologinKey,
			adminPassword: instanceData.adminPassword,
		} );
	}

	return environments;
}

/**
 * Get details for a specific VIP environment.
 */
export async function getVipEnvironment( slug: string ): Promise< VipEnvironment | null > {
	const envPath = path.join( getVipDevEnvPath(), slug );
	const instanceData = await readInstanceData( envPath );

	if ( ! instanceData ) {
		return null;
	}

	const running = await isVipEnvironmentRunning( slug );
	const urls = running ? await getVipEnvironmentUrls( slug ) : [];

	return {
		slug,
		title: instanceData.wpTitle,
		running,
		phpVersion: extractPhpVersion( instanceData.php ),
		wordpressVersion: instanceData.wordpress.tag,
		multisite: instanceData.multisite,
		elasticsearch: Boolean( instanceData.elasticsearch ),
		phpmyadmin: instanceData.phpmyadmin,
		xdebug: instanceData.xdebug,
		mailpit: instanceData.mailpit,
		path: envPath,
		urls,
		appCodePath: instanceData.appCode.mode === 'local' ? instanceData.appCode.dir : undefined,
		muPluginsPath: instanceData.muPlugins.mode === 'local' ? instanceData.muPlugins.dir : undefined,
		autologinKey: instanceData.autologinKey,
		adminPassword: instanceData.adminPassword,
	};
}

/**
 * Check if VIP CLI is available.
 */
export async function checkVipCliStatus(): Promise< VipCliStatus > {
	try {
		// Try to get VIP CLI version
		const { stdout } = await execAsync( 'vip --version', { timeout: 10000 } );
		const version = stdout.trim();

		// Try to find the path
		const whichCmd = platform() === 'win32' ? 'where vip' : 'which vip';
		let vipPath: string | undefined;
		try {
			const { stdout: pathOut } = await execAsync( whichCmd, { timeout: 5000 } );
			vipPath = pathOut.trim().split( '\n' )[ 0 ];
		} catch {
			// Path lookup failed, but CLI is still available
		}

		return {
			available: true,
			version,
			path: vipPath,
		};
	} catch ( error ) {
		return {
			available: false,
			error: error instanceof Error ? error.message : 'VIP CLI is not installed or not in PATH',
		};
	}
}

/**
 * Get common paths where npm global packages might be installed.
 */
function getCommonNpmPaths(): string[] {
	const home = homedir();
	const paths: string[] = [];

	if ( platform() === 'darwin' || platform() === 'linux' ) {
		// Common npm global paths on macOS/Linux
		paths.push(
			'/usr/local/bin',
			'/opt/homebrew/bin', // Homebrew on Apple Silicon
			'/usr/local/opt/node/bin',
			path.join( home, '.npm-global', 'bin' ),
			path.join( home, '.nvm', 'versions', 'node' ), // NVM - will need to find actual version
			path.join( home, 'n', 'bin' ), // n version manager
			path.join( home, '.local', 'bin' ),
			'/opt/local/bin' // MacPorts
		);

		// Try to find active Node version from common version managers
		const nvmDir = process.env.NVM_DIR || path.join( home, '.nvm' );
		if ( fs.existsSync( nvmDir ) ) {
			const versionsDir = path.join( nvmDir, 'versions', 'node' );
			if ( fs.existsSync( versionsDir ) ) {
				try {
					const versions = fs.readdirSync( versionsDir );
					for ( const version of versions ) {
						paths.push( path.join( versionsDir, version, 'bin' ) );
					}
				} catch {
					// Ignore errors
				}
			}
		}
	}

	return paths;
}

/**
 * Execute a VIP CLI command using spawn for better streaming and cross-platform support.
 * Uses shell: true to ensure proper PATH resolution.
 */
export async function executeVipCommand(
	args: string[],
	options: { timeout?: number } = {}
): Promise< VipCommandResult > {
	const timeout = options.timeout || 120000; // 2 minute default

	return new Promise( ( resolve ) => {
		// Build extended PATH with common npm global locations
		const currentPath = process.env.PATH || '';
		const additionalPaths = getCommonNpmPaths();
		const extendedPath = [ ...additionalPaths, currentPath ].join( path.delimiter );

		// Build the command with slug argument properly formatted
		const vipArgs = args.map( ( arg ) => {
			// Ensure arguments with = are properly quoted if they contain spaces
			if ( arg.includes( '=' ) && arg.includes( ' ' ) ) {
				const [ key, ...valueParts ] = arg.split( '=' );
				return `${ key }="${ valueParts.join( '=' ) }"`;
			}
			return arg;
		} );

		const spawnOptions = {
			shell: true, // Important for cross-platform compatibility
			env: {
				...process.env,
				PATH: extendedPath,
			},
		};

		const childProcess = spawn( 'vip', vipArgs, spawnOptions );

		let stdout = '';
		let stderr = '';
		let timedOut = false;

		// Set up timeout if specified
		let timeoutId: NodeJS.Timeout | undefined;
		if ( timeout > 0 ) {
			timeoutId = setTimeout( () => {
				timedOut = true;
				childProcess.kill( 'SIGTERM' );
			}, timeout );
		}

		childProcess.stdout?.on( 'data', ( data: Buffer ) => {
			stdout += data.toString();
		} );

		childProcess.stderr?.on( 'data', ( data: Buffer ) => {
			stderr += data.toString();
		} );

		childProcess.on( 'close', ( code: number | null ) => {
			if ( timeoutId ) {
				clearTimeout( timeoutId );
			}

			if ( timedOut ) {
				resolve( {
					success: false,
					stdout,
					stderr: stderr || 'Command timed out',
					exitCode: code,
				} );
				return;
			}

			// If the command wasn't found, provide a helpful error message
			if (
				code === 127 ||
				stderr.includes( 'command not found' ) ||
				stderr.includes( 'not recognized' )
			) {
				resolve( {
					success: false,
					stdout,
					stderr:
						'VIP CLI not found. Please ensure @automattic/vip-cli is installed globally (npm install -g @automattic/vip-cli) and restart Studio.',
					exitCode: 127,
				} );
				return;
			}

			resolve( {
				success: code === 0,
				stdout,
				stderr,
				exitCode: code,
			} );
		} );

		childProcess.on( 'error', ( error: Error ) => {
			if ( timeoutId ) {
				clearTimeout( timeoutId );
			}

			resolve( {
				success: false,
				stdout,
				stderr: error.message,
				exitCode: null,
			} );
		} );
	} );
}

/**
 * Start a VIP environment.
 */
export async function startVipEnvironment(
	slug: string,
	options: VipStartOptions = {}
): Promise< VipCommandResult > {
	const args = [ 'dev-env', 'start', `--slug=${ slug }` ];

	if ( options.skipRebuild ) {
		args.push( '--skip-rebuild' );
	}

	// Skip WordPress version check prompt to run non-interactively
	args.push( '--skip-wp-versions-check' );

	return executeVipCommand( args, { timeout: 300000 } ); // 5 minute timeout for start
}

/**
 * Stop a VIP environment.
 */
export async function stopVipEnvironment( slug: string ): Promise< VipCommandResult > {
	return executeVipCommand( [ 'dev-env', 'stop', `--slug=${ slug }` ], { timeout: 60000 } );
}

/**
 * Get VIP environment info via CLI (includes health check).
 */
export async function getVipEnvironmentInfo( slug: string ): Promise< VipCommandResult > {
	return executeVipCommand( [ 'dev-env', 'info', `--slug=${ slug }` ], { timeout: 30000 } );
}

/**
 * Open shell in VIP environment.
 */
export async function openVipShell( slug: string ): Promise< VipCommandResult > {
	// This will open an interactive shell, so we use a longer timeout
	return executeVipCommand( [ 'dev-env', 'shell', `--slug=${ slug }` ], { timeout: 0 } );
}

/**
 * Create a new VIP environment.
 */
export async function createVipEnvironment(
	options: VipCreateOptions
): Promise< VipCommandResult > {
	const args = [ 'dev-env', 'create', `--slug=${ options.slug }` ];

	// Add optional parameters
	if ( options.title ) {
		args.push( `--title=${ options.title }` );
	}

	if ( options.phpVersion ) {
		args.push( `--php=${ options.phpVersion }` );
	}

	if ( options.multisite ) {
		if ( options.multisite === true ) {
			args.push( '--multisite' );
		} else if ( options.multisite === 'subdomain' || options.multisite === 'subdirectory' ) {
			args.push( `--multisite=${ options.multisite }` );
		}
	}

	if ( options.appCodePath ) {
		args.push( `--app-code=${ options.appCodePath }` );
	}

	if ( options.muPluginsPath ) {
		args.push( `--mu-plugins=${ options.muPluginsPath }` );
	}

	if ( options.elasticsearch ) {
		args.push( '--elasticsearch' );
	}

	if ( options.phpmyadmin ) {
		args.push( '--phpmyadmin' );
	}

	if ( options.xdebug ) {
		args.push( '--xdebug' );
	}

	if ( options.mailpit ) {
		args.push( '--mailpit' );
	}

	if ( options.photon ) {
		args.push( '--photon' );
	}

	if ( options.cron ) {
		args.push( '--cron' );
	}

	if ( options.mediaRedirectDomain ) {
		args.push( `--media-redirect-domain=${ options.mediaRedirectDomain }` );
	}

	// Add non-interactive flag to avoid prompts
	args.push( '--yes' );

	// Creating an environment can take a while due to Docker image pulls
	return executeVipCommand( args, { timeout: 600000 } ); // 10 minute timeout
}
