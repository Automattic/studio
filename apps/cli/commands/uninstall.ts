import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confirm } from '@inquirer/prompts';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { __, sprintf } from '@wordpress/i18n';
import trash from 'trash';
import { Mode, runCommand as stopSites } from 'cli/commands/site/stop';
import { getCliInstallKind } from 'cli/lib/update-notifier';
import { StudioArgv } from 'cli/types';

// The launcher execs `<installDir>/bin/node`, so the running binary's grandparent
// is the standalone install root (handles a STUDIO_CLI_HOME override too — no need
// to assume ~/.studio).
function getInstallDir(): string {
	return path.dirname( path.dirname( process.execPath ) );
}

// Remove the `~/.local/bin/studio` PATH symlink, but only if it still points at
// the bundle we're removing. The shared `export PATH=…/.local/bin` rc line is left
// alone — the desktop app relies on it too.
function removePosixSymlink( installDir: string ): string | null {
	const symlink = path.join( os.homedir(), '.local', 'bin', 'studio' );
	try {
		if ( ! fs.lstatSync( symlink ).isSymbolicLink() ) {
			return null;
		}
		const target = path.resolve( path.dirname( symlink ), fs.readlinkSync( symlink ) );
		if ( target !== path.join( installDir, 'bin', 'studio' ) ) {
			return null;
		}
		fs.unlinkSync( symlink );
		return symlink;
	} catch {
		return null;
	}
}

// Windows locks bin\node.exe while the CLI runs, so we can't delete our own
// runtime in-process. Hand the destructive work to a detached PowerShell helper
// that waits for this PID to exit, then removes the bundle dirs and strips the
// installer's PATH registry entry (mirroring install.ps1's raw-registry write).
function scheduleWindowsCleanup( installDir: string ): void {
	const q = ( p: string ) => p.replace( /'/g, "''" );
	const binDir = path.join( installDir, 'bin' );
	const script = `
$ErrorActionPreference = 'SilentlyContinue'
while (Get-Process -Id ${
		process.pid
	} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }
Remove-Item -LiteralPath '${ q( binDir ) }' -Recurse -Force
Remove-Item -LiteralPath '${ q( path.join( installDir, 'cli' ) ) }' -Recurse -Force
Remove-Item -LiteralPath '${ q( installDir ) }' -Force
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($key) {
	$raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
	$parts = $raw -split ';' | Where-Object { $_ -ne '' -and $_ -ne '${ q( binDir ) }' }
	[Environment]::SetEnvironmentVariable('PATH', ($parts -join ';'), 'User')
	$key.Close()
}
`;
	spawn(
		'powershell.exe',
		[ '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script ],
		{ detached: true, stdio: 'ignore', windowsHide: true }
	).unref();
}

export async function runCommand( purge: boolean ): Promise< void > {
	const installKind = getCliInstallKind();

	if ( installKind === 'npm' ) {
		console.log(
			__( 'This Studio CLI was installed via npm. Remove it with: npm rm -g wp-studio' )
		);
		process.exitCode = 1;
		return;
	}
	if ( installKind !== 'standalone' ) {
		console.log(
			__(
				'This Studio CLI is bundled with the Studio desktop app. Uninstall the app to remove it.'
			)
		);
		process.exitCode = 1;
		return;
	}

	const installDir = getInstallDir();

	// Stop running sites + the daemon first so nothing holds open handles on the
	// runtime we're about to delete (mandatory on Windows; tidy on POSIX).
	try {
		await stopSites( Mode.STOP_ALL_SITES, undefined );
	} catch {
		// Best-effort — a broken/already-stopped install shouldn't block uninstall.
	}

	const configDir = getConfigDirectory();
	let removeConfig = purge;
	if ( purge && process.stdin.isTTY ) {
		removeConfig = await confirm( {
			message: sprintf(
				/* translators: %s is the config directory path */
				__( 'Delete your Studio config in %s?' ),
				configDir
			),
			default: false,
		} );
	}

	const removed: string[] = [];

	if ( process.platform === 'win32' ) {
		// PATH entry + runtime dirs are removed by the detached helper after exit.
		scheduleWindowsCleanup( installDir );
		removed.push( path.join( installDir, 'bin' ), path.join( installDir, 'cli' ) );
	} else {
		for ( const dir of [ path.join( installDir, 'bin' ), path.join( installDir, 'cli' ) ] ) {
			fs.rmSync( dir, { recursive: true, force: true } );
			removed.push( dir );
		}
		const symlink = removePosixSymlink( installDir );
		if ( symlink ) {
			removed.push( symlink );
		}
	}

	if ( removeConfig ) {
		// Trash rather than hard-delete — the user's sites/config are recoverable if they
		// change their mind.
		await trash( configDir );
		removed.push( configDir );
	}

	console.log( __( 'Studio CLI uninstalled. Removed:' ) );
	for ( const item of removed ) {
		console.log( `  ${ item }` );
	}
	if ( ! removeConfig ) {
		console.log(
			sprintf(
				/* translators: %s is the config directory path */
				__( '\nYour Studio config and sites are still in %s.' ),
				configDir
			)
		);
	}
	if ( process.platform === 'win32' ) {
		console.log( __( '\nThe runtime and PATH entry are removed once this process exits.' ) );
	} else {
		console.log(
			__( '\nThe ".local/bin" PATH line in your shell profile was left for the desktop app.' )
		);
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'uninstall',
		describe: __( 'Uninstall the standalone Studio CLI' ),
		builder: ( yargs ) => {
			return yargs.option( 'purge', {
				type: 'boolean',
				alias: 'all',
				describe: __( 'Also delete your Studio config (~/.studio)' ),
				default: false,
			} );
		},
		handler: async ( argv ) => {
			await runCommand( Boolean( argv.purge ) );
		},
	} );
};
