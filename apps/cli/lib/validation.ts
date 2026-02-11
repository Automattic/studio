import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { DEMO_SITE_SIZE_LIMIT_BYTES, DEMO_SITE_SIZE_LIMIT_GB } from '@studio/common/constants';
import { calculateDirectorySize } from '@studio/common/lib/fs-utils';
import { LoggerError } from 'cli/logger';

export async function validateSiteSize( siteFolder: string ): Promise< true > {
	const wpContentPath = path.join( siteFolder, 'wp-content' );
	const wpContentSize = await calculateDirectorySize( wpContentPath );

	if ( wpContentSize > DEMO_SITE_SIZE_LIMIT_BYTES ) {
		throw new LoggerError(
			sprintf(
				__(
					'Your site exceeds the %d GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
				),
				DEMO_SITE_SIZE_LIMIT_GB
			)
		);
	}

	return true;
}
