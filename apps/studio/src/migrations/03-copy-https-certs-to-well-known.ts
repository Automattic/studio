/**
 * Migrates the `certificates` directory from the platform-specific Electron location to a
 * well-known location at `~/.studio/certificates`.
 *
 * The old directory is intentionally not deleted. It'll be cleaned up in a future migration.
 */

import fs from 'node:fs';
import { getCertificatesPath } from '@studio/common/lib/well-known-paths';
import { getOldUserDataCertificatesPath } from 'src/storage/paths';
import type { Migration } from '@studio/common/lib/migration';

const NEW_CERT_DIR = getCertificatesPath();
const OLD_CERT_DIR = getOldUserDataCertificatesPath();

export const copyHttpsCertsToWellKnown: Migration = {
	needsToRun: async () => {
		return fs.existsSync( OLD_CERT_DIR ) && ! fs.existsSync( NEW_CERT_DIR );
	},
	run: async () => {
		await fs.promises.mkdir( NEW_CERT_DIR, { recursive: true } );

		if ( fs.existsSync( OLD_CERT_DIR ) ) {
			await fs.promises.cp( OLD_CERT_DIR, NEW_CERT_DIR, {
				recursive: true,
				verbatimSymlinks: true,
			} );
		}
	},
};
