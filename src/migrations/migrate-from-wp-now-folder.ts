import { app } from 'electron';
import path from 'path';
import { pathExists, recursiveCopyDirectory } from '../lib/fs-utils';
import { getServerFilesPath } from '../storage/paths';
import { loadUserData } from '../storage/user-data';

const wpNowPath = path.join( app.getPath( 'home' ), '.wp-now' );

// Database and server files are no longer stored in ~/.wp-now
// In order to help our early adopters, we'll do a one-time migration from
// ~/.wp-now to ~/Library/Application Support/Build
export async function needsToMigrateFromWpNowFolder() {
	if ( ! ( await pathExists( wpNowPath ) ) ) {
		return false;
	}

	if ( await pathExists( getServerFilesPath() ) ) {
		// Either the migration has already been done, or they weren't an early adopter.
		return false;
	}

	// Only copy ~/.wp-now if at least one of those sites refers to a site
	// in our app.
	const { sites } = await loadUserData();
	return !! sites.length;
}

export async function migrateFromWpNowFolder() {
	await recursiveCopyDirectory( wpNowPath, getServerFilesPath() );
}
