import fs from 'fs';
import path from 'path';
import { __ } from '@wordpress/i18n';
import { STUDIO_CLI_HOME } from 'cli/lib/paths';
import { getAppdataDirectory } from 'cli/lib/server-files';
import { LoggerError } from 'cli/logger';

/**
 * Checks compatibility between the standalone CLI and the installed Studio Desktop app.
 *
 * If Studio Desktop is installed (platform-specific appdata exists) but the shared
 * config at ~/.studio/appdata.json is missing, it means Studio hasn't been updated
 * to a version that supports the shared location. In that case, prompt the user
 * to update Studio.
 */
export async function checkStudioCompatibility(): Promise< void > {
	const sharedAppdataPath = path.join( STUDIO_CLI_HOME, 'appdata.json' );
	if ( fs.existsSync( sharedAppdataPath ) ) {
		return;
	}

	const oldAppdataPath = path.join( getAppdataDirectory(), 'appdata-v1.json' );
	if ( fs.existsSync( oldAppdataPath ) ) {
		throw new LoggerError(
			__(
				'A newer version of Studio is required. Please update the Studio desktop app to continue using the CLI.'
			)
		);
	}
}
