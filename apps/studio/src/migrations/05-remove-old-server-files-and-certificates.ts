/**
 * If ./02-migrate-to-split-config.ts was successful, this migration removes
 * deprecated files left behind in the platform-specific Electron app data
 * location (e.g. `~/Library/Application Support/Studio/` on macOS):
 *
 * - `server-files/` and `certificates/` directories
 * - the legacy `appdata-v1.deprecated.json` config file
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	getOldAppdataFilePath,
	getOldServerFilesPath,
	getOldUserDataCertificatesPath,
} from 'src/storage/paths';
import type { Migration } from '@studio/common/lib/migration';

const DEPRECATED_APPDATA_FILE_PATH = path.join(
	path.dirname( getOldAppdataFilePath() ),
	'appdata-v1.deprecated.json'
);

export const removeOldServerFilesAndCertificates: Migration = {
	needsToRun: async () => {
		return fs.existsSync( DEPRECATED_APPDATA_FILE_PATH );
	},
	run: async () => {
		await fs.promises.rm( getOldServerFilesPath(), { recursive: true, force: true } );
		await fs.promises.rm( getOldUserDataCertificatesPath(), { recursive: true, force: true } );
		await fs.promises.rm( DEPRECATED_APPDATA_FILE_PATH, { recursive: true, force: true } );
	},
};
