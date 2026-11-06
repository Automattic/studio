import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { __ } from '@wordpress/i18n';
import { writeFile } from 'atomically';
import semver from 'semver';
import { x as extract } from 'tar';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import { confirm } from 'cli/lib/prompts';
import {
	channelForVersion,
	getAvailableCliUpdate,
	getCliInstallKind,
	type CliInstallKind,
} from 'cli/lib/update-notifier';

export const CLI_VERSIONS_DIRECTORY = 'cli-versions';
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const execFileAsync = promisify( execFile );

export function getStandaloneInstallDir(): string {
	const runtimeDirectory = path.dirname( path.dirname( process.execPath ) );
	return path.basename( path.dirname( runtimeDirectory ) ) === CLI_VERSIONS_DIRECTORY
		? path.dirname( path.dirname( runtimeDirectory ) )
		: runtimeDirectory;
}

async function readActiveVersion( installDirectory: string ): Promise< string | null > {
	try {
		const version = (
			await fs.promises.readFile(
				path.join( installDirectory, CLI_VERSIONS_DIRECTORY, 'current' ),
				'utf8'
			)
		).trim();
		return semver.valid( version ) === version ? version : null;
	} catch {
		return null;
	}
}

function runtimePaths( directory: string ) {
	return {
		node: path.join( directory, 'bin', process.platform === 'win32' ? 'node.exe' : 'node' ),
		main: path.join( directory, 'cli', 'main.mjs' ),
	};
}

// Keep the installed launcher and its runtime intact. Processes already using an older
// version (including MCP servers and site daemons) can finish using that version's files.
export async function launchUpdatedCli(
	currentVersion: string,
	installKind: CliInstallKind = getCliInstallKind()
): Promise< boolean > {
	if (
		installKind !== 'standalone' ||
		process.send ||
		process.argv.slice( 2 ).includes( 'uninstall' ) ||
		! semver.valid( currentVersion )
	) {
		return false;
	}
	const installDirectory = getStandaloneInstallDir();
	const version = await readActiveVersion( installDirectory );
	if (
		! version ||
		channelForVersion( version ) !== channelForVersion( currentVersion ) ||
		! semver.gt( version, currentVersion )
	) {
		return false;
	}
	const runtime = runtimePaths( path.join( installDirectory, CLI_VERSIONS_DIRECTORY, version ) );
	if ( ! fs.existsSync( runtime.node ) || ! fs.existsSync( runtime.main ) ) {
		return false;
	}
	return new Promise( ( resolve ) => {
		const child = spawn( runtime.node, [ runtime.main, ...process.argv.slice( 2 ) ], {
			stdio: 'inherit',
			windowsHide: true,
		} );
		const onInterrupt = () => child.kill( 'SIGINT' );
		const onTerminate = () => child.kill( 'SIGTERM' );
		process.on( 'SIGINT', onInterrupt );
		process.on( 'SIGTERM', onTerminate );
		const cleanup = () => {
			process.off( 'SIGINT', onInterrupt );
			process.off( 'SIGTERM', onTerminate );
		};
		child.once( 'error', () => {
			cleanup();
			resolve( false );
		} );
		child.once( 'exit', ( code, signal ) => {
			cleanup();
			process.exitCode = code ?? ( signal === 'SIGINT' ? 130 : 143 );
			resolve( true );
		} );
	} );
}

export async function setupStandaloneAutoUpdates(
	installKind: CliInstallKind = getCliInstallKind()
): Promise< void > {
	if (
		installKind !== 'standalone' ||
		process.send ||
		process.env.STUDIO_CLI_DISABLE_AUTO_UPDATES === '1' ||
		process.argv
			.slice( 2 )
			.some( ( arg ) =>
				[ 'update', 'uninstall', '--help', '-h', '--version', '-v' ].includes( arg )
			)
	) {
		return;
	}
	try {
		let enabled = ( await readCliConfig() ).cliAutoUpdates;
		if (
			enabled === undefined &&
			process.stdin.isTTY &&
			process.stdout.isTTY &&
			process.stderr.isTTY &&
			! process.argv.includes( '--json' )
		) {
			enabled = await confirm(
				{
					message: __(
						'Keep Studio CLI up to date automatically? Updates download in the background and take effect on your next launch.'
					),
					default: true,
				},
				{ output: process.stderr }
			);
			await updateCliConfigWithPartial( { cliAutoUpdates: enabled } );
		}
		if ( ! enabled ) {
			return;
		}
		const child = spawn(
			process.execPath,
			[ path.join( import.meta.dirname, 'cli-updater.mjs' ) ],
			{
				detached: true,
				stdio: 'ignore',
				windowsHide: true,
			}
		);
		child.on( 'error', () => undefined );
		child.unref();
	} catch {
		// A failed prompt, config read or background launch must not break a command.
	}
}

export async function updateStandaloneCli(
	currentVersion: string,
	{ automatic = false }: { automatic?: boolean } = {}
): Promise< string | null > {
	if ( automatic ) {
		if (
			process.env.STUDIO_CLI_DISABLE_AUTO_UPDATES === '1' ||
			! ( await readCliConfig() ).cliAutoUpdates ||
			! ( await getAvailableCliUpdate( currentVersion, 'standalone' ) )
		) {
			return null;
		}
	}
	const installDirectory = getStandaloneInstallDir();
	const versionsDirectory = path.join( installDirectory, CLI_VERSIONS_DIRECTORY );
	await fs.promises.mkdir( versionsDirectory, { recursive: true } );
	const lock = path.join( versionsDirectory, 'update.lock' );
	await lockFileAsync( lock, { wait: 0, stale: 15 * 60 * 1000 } );
	let stagingDirectory: string | undefined;
	try {
		const update = await getAvailableCliUpdate( currentVersion, 'standalone', true );
		if ( ! update ) {
			return null;
		}
		const active = await readActiveVersion( installDirectory );
		if (
			active &&
			channelForVersion( active ) === channelForVersion( update.latestVersion ) &&
			semver.gte( active, update.latestVersion )
		) {
			return active;
		}
		const url = new URL( update.downloadUrl ?? '' );
		if (
			url.origin !== 'https://appscdn.wordpress.com' ||
			! url.pathname.startsWith( '/downloads/wordpress-com-studio-cli/' )
		) {
			throw new Error( __( 'The update server returned an invalid Studio CLI download URL.' ) );
		}
		const destination = path.join( versionsDirectory, update.latestVersion );
		if ( fs.existsSync( destination ) ) {
			await verifyRuntime( destination, update.latestVersion );
			await writeFile( path.join( versionsDirectory, 'current' ), `${ update.latestVersion }\n` );
			return update.latestVersion;
		}
		stagingDirectory = await fs.promises.mkdtemp( path.join( versionsDirectory, '.download-' ) );
		const archive = path.join( stagingDirectory, 'studio.tgz' );
		const response = await fetch( url, { signal: AbortSignal.timeout( DOWNLOAD_TIMEOUT_MS ) } );
		if ( ! response.ok || ! response.body ) {
			throw new Error( __( 'Failed to download the Studio CLI update.' ) );
		}
		await pipeline(
			Readable.fromWeb( response.body as Parameters< typeof Readable.fromWeb >[ 0 ] ),
			fs.createWriteStream( archive )
		);
		const extracted = path.join( stagingDirectory, 'extracted' );
		await fs.promises.mkdir( extracted );
		await extract( { file: archive, cwd: extracted, strict: true } );
		const runtime = runtimePaths( extracted );
		if ( process.platform !== 'win32' ) {
			await fs.promises.chmod( runtime.node, 0o755 );
		}
		await verifyRuntime( extracted, update.latestVersion );
		await fs.promises.rename( extracted, destination );
		await writeFile( path.join( versionsDirectory, 'current' ), `${ update.latestVersion }\n` );
		return update.latestVersion;
	} finally {
		if ( stagingDirectory ) {
			await fs.promises.rm( stagingDirectory, { recursive: true, force: true } );
		}
		await unlockFileAsync( lock );
	}
}

async function verifyRuntime( directory: string, version: string ): Promise< void > {
	const runtime = runtimePaths( directory );
	const { stdout } = await execFileAsync( runtime.node, [ runtime.main, '--version' ], {
		timeout: 30_000,
		windowsHide: true,
	} );
	if ( stdout.trim() !== version ) {
		throw new Error( __( 'The downloaded Studio CLI version does not match the update.' ) );
	}
}
