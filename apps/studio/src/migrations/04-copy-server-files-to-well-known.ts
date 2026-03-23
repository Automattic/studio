/**
 * Migrates the `server-files` directory from the platform-specific Electron location to a
 * well-known location at `~/.studio/server-files`.
 *
 * The old directory is intentionally not deleted. It'll be cleaned up in a future migration.
 */

import fs from 'node:fs';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { getOldServerFilesPath } from 'src/storage/paths';
import type { Migration } from '@studio/common/lib/migration';

const NEW_SERVER_FILES_DIR = getServerFilesPath();
const OLD_SERVER_FILES_DIR = getOldServerFilesPath();

export const copyServerFilesToWellKnown: Migration = {
	needsToRun: async () => {
		return fs.existsSync( OLD_SERVER_FILES_DIR ) && ! fs.existsSync( NEW_SERVER_FILES_DIR );
	},
	run: async () => {
		await fs.promises.mkdir( NEW_SERVER_FILES_DIR, { recursive: true } );

		if ( fs.existsSync( OLD_SERVER_FILES_DIR ) ) {
			await fs.promises.cp( OLD_SERVER_FILES_DIR, NEW_SERVER_FILES_DIR, {
				recursive: true,
				verbatimSymlinks: true,
			} );
		}
	},
};
