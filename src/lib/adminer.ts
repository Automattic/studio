import fs from 'fs';
import nodePath from 'path';
import { pathExists, recursiveCopyDirectory } from 'src/lib/fs-utils';
import { getSiteUrl } from 'src/lib/get-site-url';

export async function setupAdminer( siteDetails: SiteDetails ) {
	try {
		const adminerPath = nodePath.join( siteDetails.path, 'adminer' );
		const sourceVersionPath = 'vendor/adminer/version.txt';
		const destVersionPath = `${ adminerPath }/version.txt`;

		// Check if we need to update
		let shouldUpdate = false;

		try {
			const exists = await pathExists( adminerPath );
			if ( ! exists ) {
				shouldUpdate = true;
			} else {
				const sourceVersion = await fs.promises
					.readFile( sourceVersionPath, 'utf8' )
					.then( ( v ) => v.trim() );
				const destVersion = await fs.promises
					.readFile( destVersionPath, 'utf8' )
					.then( ( v ) => v.trim() )
					.catch( () => '0.0.0' ); // If version file doesn't exist, assume old version

				shouldUpdate = sourceVersion !== destVersion;
				if ( shouldUpdate ) {
					console.log( `Updating adminer from version ${ destVersion } to ${ sourceVersion }` );
				}
			}
		} catch ( error ) {
			// If any error occurs during version check, force an update
			console.error( 'Error checking adminer versions:', error );
			shouldUpdate = true;
		}

		if ( shouldUpdate ) {
			try {
				await recursiveCopyDirectory( 'vendor/adminer', adminerPath );
			} catch ( copyError ) {
				throw new Error( `Failed to copy adminer directory: ${ ( copyError as Error ).message }` );
			}
		}

		// Update config.php with site details.
		const configPath = nodePath.join( adminerPath, 'config.php' );
		try {
			const config = await fs.promises.readFile( configPath, 'utf8' );
			const siteUrl = getSiteUrl( siteDetails );
			await fs.promises.writeFile(
				configPath,
				config
					.replace( '{ADMINER_WP_SITE_NAME}', siteDetails.name )
					.replace( '{ADMINER_WP_SITE_URL}', siteUrl )
					.replace( '{ADMINER_WP_SITE_ADMIN_URL}', `${ siteUrl }/wp-admin` )
			);
		} catch ( configError ) {
			throw new Error( 'Failed to update adminer config.php: ' + ( configError as Error ).message );
		}
	} catch ( error ) {
		console.error( 'Error setting up adminer:', error );
		throw error;
	}
}
