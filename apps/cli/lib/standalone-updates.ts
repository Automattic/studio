import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { downloadFile } from '@studio/common/lib/download-file';
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
const execFileAsync = promisify( execFile );

export function getStandaloneInstallDir(): string {
	const runtimeDirectory = path.dirname( path.dirname( process.execPath ) );
	const versionsDirectory = path.dirname( runtimeDirectory );
	const installDirectory = path.dirname( versionsDirectory );
	return path.basename( versionsDirectory ) === CLI_VERSIONS_DIRECTORY &&
		semver.valid( path.basename( runtimeDirectory ) ) &&
		fs.existsSync( path.join( installDirectory, 'cli', 'version' ) )
		? installDirectory
		: runtimeDirectory;
}

async function readActiveVersion( file: string ): Promise< string | null > {
	try {
		const version = ( await fs.promises.readFile( file, 'utf8' ) ).trim();
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
						'Keep Studio CLI up to date automatically? Updates take effect on your next launch.'
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
	const installedVersion = (
		await fs.promises.readFile( path.join( installDirectory, 'cli', 'version' ), 'utf8' )
	).trim();
	if ( ! semver.valid( installedVersion ) ) {
		throw new Error( __( 'Invalid installed Studio CLI version.' ) );
	}
	if ( channelForVersion( installedVersion ) !== channelForVersion( currentVersion ) ) {
		return null;
	}
	const versionsDirectory = path.join( installDirectory, CLI_VERSIONS_DIRECTORY );
	// A manual reinstall changes this key, so an old update cannot replace the new install.
	const currentFile = path.join( versionsDirectory, `current-${ installedVersion }` );
	await fs.promises.mkdir( versionsDirectory, { recursive: true } );
	const lock = path.join( versionsDirectory, 'update.lock' );
	await lockFileAsync( lock, { wait: 0, stale: 60 * 60 * 1000 } );
	let stagingDirectory: string | undefined;
	try {
		const update = await getAvailableCliUpdate( currentVersion, 'standalone', true );
		if ( ! update || semver.lte( update.latestVersion, installedVersion ) ) {
			return null;
		}
		const active = await readActiveVersion( currentFile );
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
			await writeFile( currentFile, `${ update.latestVersion }\n` );
			return update.latestVersion;
		}
		stagingDirectory = await fs.promises.mkdtemp( path.join( versionsDirectory, '.download-' ) );
		const archive = path.join( stagingDirectory, 'studio.tgz' );
		await downloadFile( url.toString(), archive );
		const extracted = path.join( stagingDirectory, 'extracted' );
		await fs.promises.mkdir( extracted );
		await extract( { file: archive, cwd: extracted, strict: true } );
		const runtime = runtimePaths( extracted );
		if ( process.platform !== 'win32' ) {
			await fs.promises.chmod( runtime.node, 0o755 );
		}
		await verifyRuntime( extracted, update.latestVersion );
		await fs.promises.rename( extracted, destination );
		await writeFile( currentFile, `${ update.latestVersion }\n` );
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
