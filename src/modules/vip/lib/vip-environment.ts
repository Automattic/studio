/**
 * VIP Local Development Environment detection and management.
 *
 * This module reads VIP environment data directly from the filesystem
 * rather than parsing CLI output, providing a more reliable integration.
 */

import { exec } from 'child_process';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { homedir, platform } from 'os';
import path from 'path';
import { promisify } from 'util';
import type {
	VipCliStatus,
	VipCommandResult,
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
 * Execute a VIP CLI command.
 */
export async function executeVipCommand(
	args: string[],
	options: { timeout?: number } = {}
): Promise< VipCommandResult > {
	const timeout = options.timeout || 120000; // 2 minute default

	return new Promise( ( resolve ) => {
		const command = `vip ${ args.join( ' ' ) }`;

		exec( command, { timeout }, ( error, stdout, stderr ) => {
			resolve( {
				success: ! error,
				stdout,
				stderr,
				exitCode: error?.code ?? 0,
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

	if ( options.skipWpVersionCheck ) {
		args.push( '--skip-wp-versions-check' );
	}

	// Add non-interactive flag to avoid prompts
	args.push( '--yes' );

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
