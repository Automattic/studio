import { __ } from '@wordpress/i18n';
import { getSiteByFolder, readAppdata, SiteData } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';

/**
 * Get a site by ID or from the current working directory.
 * If siteId is provided, uses that. Otherwise, tries to detect from cwd.
 */
export async function getSiteForSync( siteId?: string, cwd?: string ): Promise< SiteData > {
	if ( siteId ) {
		// Use provided site ID
		const appdata = await readAppdata();
		const site = appdata.sites.find( ( s ) => s.id === siteId );
		if ( ! site ) {
			throw new LoggerError( __( 'Site not found' ) );
		}
		return site;
	}

	// Try to detect from current directory
	const workingDir = cwd || process.cwd();
	try {
		return await getSiteByFolder( workingDir );
	} catch ( error ) {
		throw new LoggerError(
			__(
				'No site ID provided and current directory is not a Studio site.\n\nEither run this command from a site directory or provide a site ID:\n  studio sync <command> <local-site-id>'
			)
		);
	}
}
