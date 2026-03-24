import fs from 'fs';
import path from 'path';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { getAppdataDirectory } from 'cli/lib/server-files';
import { LoggerError } from 'cli/logger';
import type { Migration } from '@studio/common/lib/migration';

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
		if ( fs.existsSync( oldAppdataPath ) ) {
			throw new LoggerError(
				__(
					'A newer version of Studio is required. Please update the Studio desktop app to continue using the CLI.'
				)
			);
		}
	},
};
