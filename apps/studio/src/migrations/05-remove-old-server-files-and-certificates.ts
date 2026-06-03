/**
 * Removes deprecated files left behind in the platform-specific Electron app
 * data location (e.g. `~/Library/Application Support/Studio/` on macOS):
 *
 * - `server-files/` and `certificates/` directories
 * - the legacy `appdata-v1.json` config file (and its
 *   `appdata-v1.deprecated.json` rename)
 *
 * All of these have since moved to well-known locations under `~/.studio/`:
 * - certificates were copied over by `03-copy-https-certs-to-well-known`, which
 *   intentionally left the old copy behind for a later migration to clean up
 * - `appdata-v1.json` was split into shared.json/cli.json/app.json by
 *   `02-migrate-to-split-config`, which renamed the original to
 *   `appdata-v1.deprecated.json` and deferred its removal to a later migration
 *
 * This is that later migration.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getOldServerFilesPath, getOldUserDataCertificatesPath } from 'src/storage/paths';
import type { Migration } from '@studio/common/lib/migration';

// The old Studio app-data directory, e.g. `~/Library/Application Support/Studio`.
const OLD_APPDATA_DIR = path.dirname( getOldServerFilesPath() );

const OLD_PATHS = [
	getOldServerFilesPath(),
	getOldUserDataCertificatesPath(),
	path.join( OLD_APPDATA_DIR, 'appdata-v1.json' ),
	path.join( OLD_APPDATA_DIR, 'appdata-v1.deprecated.json' ),
];

export const removeOldServerFilesAndCertificates: Migration = {
	needsToRun: async () => {
		return OLD_PATHS.some( ( target ) => fs.existsSync( target ) );
	},
	run: async () => {
		for ( const target of OLD_PATHS ) {
			await fs.promises.rm( target, { recursive: true, force: true } );
		}
	},
};
