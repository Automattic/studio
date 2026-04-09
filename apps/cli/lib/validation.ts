import path from 'path';
import { DEMO_SITE_SIZE_LIMIT_BYTES, DEMO_SITE_SIZE_LIMIT_GB } from '@studio/common/constants';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { calculateDirectorySizeForArchive } from '@studio/common/lib/fs-utils';
import { __, sprintf } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';

export async function validateSiteSize( siteFolder: string ): Promise< true > {
	const wpContentPath = path.join( siteFolder, 'wp-content' );
	const deployIgnore = await createDeployIgnoreFilter( siteFolder );
	const wpContentSize = await calculateDirectorySizeForArchive(
		wpContentPath,
		deployIgnore,
		'wp-content'
	);

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
