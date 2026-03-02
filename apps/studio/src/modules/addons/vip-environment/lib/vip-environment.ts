/**
 * VIP Local Development Environment detection and management.
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

function getVipDataPath(): string {
	const os = platform();
	if ( os === 'win32' ) {
		const localAppData = process.env.LOCALAPPDATA || path.join( homedir(), 'AppData', 'Local' );
		return path.join( localAppData, 'vip' );
	}
	const xdgDataHome = process.env.XDG_DATA_HOME || path.join( homedir(), '.local', 'share' );
	return path.join( xdgDataHome, 'vip' );
}

export function getVipDevEnvPath(): string {
	return path.join( getVipDataPath(), 'dev-environment' );
}

function extractPhpVersion( phpImageTag: string ): string {
	const match = phpImageTag.match( /:(\d+\.\d+)/ );
	return match ? match[ 1 ] : phpImageTag;
}

async function readInstanceData( envPath: string ): Promise< VipInstanceData | null > {
	const instanceDataPath = path.join( envPath, 'instance_data.json' );
	try {
		const content = await fsPromises.readFile( instanceDataPath, 'utf-8' );
		return JSON.parse( content ) as VipInstanceData;
	} catch {
		return null;
	}
}

/**
 * Derive the Docker Compose project name from a VIP environment slug.
 * VIP/Lando strips hyphens: "example-site" → "examplesite".
 */
function composeProjectName( slug: string ): string {
	return slug.replace( /-/g, '' );
}

export async function isVipEnvironmentRunning( slug: string ): Promise< boolean > {
	try {
		const project = composeProjectName( slug );
		const { stdout } = await execAsync(
			`docker ps --filter "label=com.docker.compose.project=${ project }" --filter "label=com.docker.compose.service=nginx" --format "{{.ID}}"`,
			{ timeout: 5000 }
		);
		return stdout.trim().length > 0;
	} catch {
		return false;
	}
}

async function getVipEnvironmentUrls( slug: string ): Promise< string[] > {
	try {
		const project = composeProjectName( slug );
		const { stdout } = await execAsync(
			`docker ps --filter "label=com.docker.compose.project=${ project }" --filter "label=com.docker.compose.service=nginx" --format "{{.ID}}"`,
			{ timeout: 5000 }
		);
		if ( ! stdout.trim() ) {
			return [];
		}
		return [ `http://${ slug }.vipdev.lndo.site/` ];
	} catch {
		return [];
	}
}

export async function listVipEnvironments(): Promise< VipEnvironment[] > {
	const devEnvPath = getVipDevEnvPath();
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

export async function checkVipCliStatus(): Promise< VipCliStatus > {
	try {
		const extendedPath = getCommonNpmPaths().join( path.delimiter );
		const env = {
			...process.env,
			PATH: `${ extendedPath }${ path.delimiter }${ process.env.PATH ?? '' }`,
		};
		const { stdout } = await execAsync( 'vip --version', { timeout: 10000, env } );
		const version = stdout.trim();

		const whichCmd = platform() === 'win32' ? 'where vip' : 'which vip';
		let vipPath: string | undefined;
		try {
			const { stdout: pathOut } = await execAsync( whichCmd, { timeout: 5000, env } );
			vipPath = pathOut.trim().split( '\n' )[ 0 ];
		} catch {
			// Path lookup failed, but CLI is still available
		}

		return { available: true, version, path: vipPath };
	} catch ( error ) {
		return {
			available: false,
			error: error instanceof Error ? error.message : 'VIP CLI is not installed or not in PATH',
		};
	}
}

function getCommonNpmPaths(): string[] {
	const home = homedir();
	const paths: string[] = [];

	if ( platform() === 'darwin' || platform() === 'linux' ) {
		paths.push(
			'/usr/local/bin',
			'/opt/homebrew/bin',
			'/usr/local/opt/node/bin',
			path.join( home, '.npm-global', 'bin' ),
			path.join( home, 'n', 'bin' ),
			path.join( home, '.local', 'bin' ),
			'/opt/local/bin'
		);

		const nvmDir = process.env.NVM_DIR || path.join( home, '.nvm' );
		if ( process.env.NVM_BIN ) {
			paths.push( process.env.NVM_BIN );
		}
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

	return paths;
}

export async function executeVipCommand(
	args: string[],
	options: { timeout?: number } = {}
): Promise< VipCommandResult > {
	const timeout = options.timeout ?? 120_000;

	return new Promise( ( resolve ) => {
		const currentPath = process.env.PATH || '';
		const additionalPaths = getCommonNpmPaths();
		const extendedPath = [ ...additionalPaths, currentPath ].join( path.delimiter );

		const spawnOptions = {
			shell: true,
			env: { ...process.env, PATH: extendedPath },
		};

		const childProcess = spawn( 'vip', args, spawnOptions );

		let stdout = '';
		let stderr = '';
		let timedOut = false;

		let timeoutId: ReturnType< typeof setTimeout > | undefined;
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

			if (
				code === 127 ||
				stderr.includes( 'command not found' ) ||
				stderr.includes( 'not recognized' )
			) {
				resolve( {
					success: false,
					stdout,
					stderr:
						'VIP CLI not found. Please ensure @automattic/vip-cli is installed globally and restart Studio.',
					exitCode: 127,
				} );
				return;
			}

			resolve( { success: code === 0, stdout, stderr, exitCode: code } );
		} );

		childProcess.on( 'error', ( error: Error ) => {
			if ( timeoutId ) {
				clearTimeout( timeoutId );
			}
			resolve( { success: false, stdout, stderr: error.message, exitCode: null } );
		} );
	} );
}

export async function startVipEnvironment(
	slug: string,
	options: VipStartOptions = {}
): Promise< VipCommandResult > {
	const args = [ 'dev-env', 'start', `--slug=${ slug }` ];
	if ( options.skipRebuild ) {
		args.push( '--skip-rebuild' );
	}
	args.push( '--skip-wp-versions-check' );
	return executeVipCommand( args, { timeout: 300_000 } );
}

export async function stopVipEnvironment( slug: string ): Promise< VipCommandResult > {
	return executeVipCommand( [ 'dev-env', 'stop', `--slug=${ slug }` ], { timeout: 60_000 } );
}

export async function createVipEnvironment(
	options: VipCreateOptions
): Promise< VipCommandResult > {
	const args = [ 'dev-env', 'create', `--slug=${ options.slug }` ];

	if ( options.title ) args.push( `--title=${ options.title }` );
	if ( options.phpVersion ) args.push( `--php=${ options.phpVersion }` );
	if ( options.multisite ) {
		if ( options.multisite === true ) {
			args.push( '--multisite' );
		} else if ( options.multisite === 'subdomain' || options.multisite === 'subdirectory' ) {
			args.push( `--multisite=${ options.multisite }` );
		}
	}
	if ( options.appCodePath ) args.push( `--app-code=${ options.appCodePath }` );
	if ( options.muPluginsPath ) args.push( `--mu-plugins=${ options.muPluginsPath }` );
	if ( options.elasticsearch ) args.push( '--elasticsearch' );
	if ( options.phpmyadmin ) args.push( '--phpmyadmin' );
	if ( options.xdebug ) args.push( '--xdebug' );
	if ( options.mailpit ) args.push( '--mailpit' );
	if ( options.photon ) args.push( '--photon' );
	if ( options.cron ) args.push( '--cron' );
	if ( options.mediaRedirectDomain )
		args.push( `--media-redirect-domain=${ options.mediaRedirectDomain }` );

	args.push( '--yes' );
	return executeVipCommand( args, { timeout: 600_000 } );
}
