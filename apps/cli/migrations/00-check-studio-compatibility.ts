import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { confirm } from '@inquirer/prompts';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { getAppdataDirectory } from 'cli/lib/server-files';
import { LoggerError } from 'cli/logger';
import type { Migration } from '@studio/common/lib/migration';

function isInstalledOnMacOs() {
	return new Promise< boolean >( ( resolve, reject ) => {
		exec( `mdfind "kMDItemCFBundleIdentifier == 'com.electron.studio'"`, ( error, stdout ) => {
			if ( error ) {
				reject( error );
			} else {
				resolve( stdout.trim() !== '' );
			}
		} );
	} );
}

const MICROSOFT_STORE_IDENTITY_NAME = '22490Automattic.StudiobyWordPress.com';

function isInstalledOnWindows() {
	const localAppData = process.env.LOCALAPPDATA;
	if ( localAppData ) {
		const studioExecutablePath = path.join( localAppData, 'studio_app', 'Studio.exe' );
		if ( fs.existsSync( studioExecutablePath ) ) {
			return Promise.resolve( true );
		}
	}

	return new Promise< boolean >( ( resolve, reject ) => {
		exec(
			`powershell -NoProfile -Command 'Get-AppxPackage -Name "${ MICROSOFT_STORE_IDENTITY_NAME }" -ErrorAction SilentlyContinue'`,
			( error, stdout ) => {
				if ( error ) {
					reject( error );
				} else {
					resolve( stdout.trim() !== '' );
				}
			}
		);
	} );
}

function isStudioInstalled() {
	switch ( process.platform ) {
		case 'darwin':
			return isInstalledOnMacOs();
		case 'win32':
			return isInstalledOnWindows();
		default:
			return Promise.resolve( false );
	}
}

/**
 * Checks compatibility between the standalone CLI and the installed Studio Desktop app.
 *
 * If Studio Desktop is installed (platform-specific appdata exists) but the shared
 * config at ~/.studio/app.json is missing, it means Studio hasn't been updated
 * to a version that supports the shared location. In that case, prompt the user
 * to update Studio.
 *
 * Always needs to run. Throws if incompatible.
 */
export const checkStudioCompatibilityForInitialMigration: Migration = {
	async needsToRun() {
		return true;
	},
	async run() {
		if ( fs.existsSync( getAppConfigPath() ) ) {
			return;
		}

		const oldAppdataPath = path.join( getAppdataDirectory(), 'appdata-v1.json' );

		if ( ! fs.existsSync( oldAppdataPath ) ) {
			return;
		}

		if ( await isStudioInstalled() ) {
			throw new LoggerError(
				__(
					`It looks like you have Studio installed and you're trying to run a newer version of the CLI. Your config data needs to be updated to the new CLI-compatible format first. Please open Studio and update to the latest version before running the CLI.`
				)
			);
		}

		console.log(
			__(
				'It looks like there are old Studio config files on your system, but the Studio app is not installed. Would you like to reset your config and start with a clean slate? You can always add your existing site directories to Studio again.\n\nIf we are wrong, and Studio is in fact installed, then please open Studio and update to the latest version before running the CLI.'
			)
		);

		const shouldRenameOldConfigFile = await confirm( {
			message: __( 'Start clean?' ),
			default: false,
		} );

		if ( shouldRenameOldConfigFile ) {
			fs.renameSync(
				oldAppdataPath,
				path.join( getAppdataDirectory(), 'appdata-v1.deprecated.json' )
			);
		}
	},
};
