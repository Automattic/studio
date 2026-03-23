import { app } from 'electron';
import path from 'path';
import { pathExists, recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import { getServerFilesPath } from 'src/storage/paths';
import { loadUserData } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';

const wpNowPath = path.join( app.getPath( 'home' ), '.wp-now' );

// Database and server files are no longer stored in ~/.wp-now
// In order to help our early adopters, we'll do a one-time migration from
// ~/.wp-now to ~/Library/Application Support/Studio
export const migrateFromWpNowFolder: Migration = {
	async needsToRun() {
		if ( ! ( await pathExists( wpNowPath ) ) ) {
			return false;
		}

		if ( await pathExists( getServerFilesPath() ) ) {
			// Either the migration has already been done, or they weren't an early adopter.
			return false;
		}

		// Only copy ~/.wp-now if at least one of those sites refers to a site
		// in our app.
		const { siteMetadata } = await loadUserData();
		return Object.keys( siteMetadata ).length > 0;
	},
	async run() {
		await recursiveCopyDirectory( wpNowPath, getServerFilesPath() );
	},
};
