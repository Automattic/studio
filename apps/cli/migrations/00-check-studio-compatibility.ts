import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { confirm } from '@inquirer/prompts';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { getAppdataDirectory } from 'cli/lib/appdata';
import type { Migration } from '@studio/common/lib/migration';

function isInstalledOnMacOs() {
	return new Promise< boolean >( ( resolve, reject ) => {
		execFile(
			'mdfind',
			[ "kMDItemCFBundleIdentifier == 'com.electron.studio'" ],
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
		execFile(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				`Get-AppxPackage -Name "${ MICROSOFT_STORE_IDENTITY_NAME }" -ErrorAction SilentlyContinue`,
			],
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
 * Ensures CLI/Studio config compatibility during initial migration.
 *
 * If `~/.studio/app.json` is missing but legacy appdata exists:
 * - throw when Studio is installed (Studio must migrate first)
 * - otherwise offer to reset the legacy config
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
			console.error(
				__(
					`Studio is installed, but your config must be migrated by Studio before this CLI can run. Open Studio, update it, then try again.`
				)
			);
			process.exit( 1 );
		}

		console.log(
			__(
				'Old Studio config was found, but Studio no longer appears to be installed.\nReset this config and start clean? You can re-add site directories later.\n\nIf Studio is actually installed, open it, update it, then run the CLI again.\n'
			)
		);

		const shouldRenameOldConfigFile = await confirm( {
			message: __( 'Reset config and start clean? (Choosing No will exit the CLI)' ),
			default: false,
		} ).catch( () => false );

		if ( shouldRenameOldConfigFile ) {
			fs.renameSync(
				oldAppdataPath,
				path.join( getAppdataDirectory(), 'appdata-v1.deprecated.json' )
			);
		} else {
			console.log( __( 'Exiting…' ) );
			process.exit( 1 );
		}
	},
};
