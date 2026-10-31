import { DEMO_SITE_SIZE_LIMIT_BYTES, DEMO_SITE_SIZE_LIMIT_GB } from '@studio/common/constants';
import { __, sprintf } from '@wordpress/i18n';
import { getArchiveContentSize, type PreviewArchiveOptions } from 'cli/lib/archive';
import { LoggerError } from 'cli/logger';

export async function validateSiteSize(
	siteFolder: string,
	options: PreviewArchiveOptions
): Promise< true > {
	// Count only what the preview archive will hold; see `listArchiveEntries`.
	if ( ( await getArchiveContentSize( siteFolder, options ) ) > DEMO_SITE_SIZE_LIMIT_BYTES ) {
		throw new LoggerError(
			sprintf(
				__(
					'Your site exceeds the %d GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
				),
				DEMO_SITE_SIZE_LIMIT_GB
			),
			undefined,
			'size_limit'
		);
	}

	return true;
}
