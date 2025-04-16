import fs from 'fs';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { DEMO_SITE_SIZE_LIMIT_BYTES, DEMO_SITE_SIZE_LIMIT_GB } from 'common/constants';
import { calculateDirectorySize, isWordPressDirectory } from 'common/lib/fs-utils';
import { LoggerError } from 'cli/logger';

export function validateSiteFolder( siteFolder: string ): boolean {
	if ( ! fs.existsSync( siteFolder ) ) {
		throw new LoggerError( sprintf( __( 'Folder not found: %s' ), siteFolder ) );
	}

	if ( ! isWordPressDirectory( siteFolder ) ) {
		throw new LoggerError(
			__(
				`The specified folder doesn't appear to be a WordPress site. ` +
					`Please ensure it contains a wp-content directory.`
			)
		);
	}

	return true;
}

export async function validateSiteSize( siteFolder: string ): Promise< true > {
	const wpContentPath = path.join( siteFolder, 'wp-content' );
	const wpContentSize = await calculateDirectorySize( wpContentPath );

	if ( wpContentSize > DEMO_SITE_SIZE_LIMIT_BYTES ) {
		throw new LoggerError(
			sprintf(
				__(
					'Your site exceeds the %s GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
				),
				DEMO_SITE_SIZE_LIMIT_GB
			)
		);
	}

	return true;
}
