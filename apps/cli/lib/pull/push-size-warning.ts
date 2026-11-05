import path from 'path';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { calculateDirectorySizeForArchive } from '@studio/common/lib/fs-utils';
import {
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { __, sprintf } from '@wordpress/i18n';

/**
 * A warning when a pulled site looks too big to push back to WordPress.com.
 *
 * Reprint streams the site in pieces, so unlike the Jetpack backup there is no archive size to check
 * before downloading; this measures what landed in wp-content instead. Push uploads a gzipped
 * archive, so the uncompressed tally over-reports, which is why the warning says "may": a false
 * alarm is cheap, a missed one surfaces as a failed push. Goes away when push moves to Reprint.
 */
export async function getPushSizeWarning( sitePath: string ): Promise< string | undefined > {
	try {
		const wpContentSize = await calculateDirectorySizeForArchive(
			path.join( sitePath, 'wp-content' ),
			await createDeployIgnoreFilter( sitePath ),
			'wp-content'
		);
		if ( wpContentSize <= SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			return undefined;
		}
		return sprintf(
			__(
				'This site is over %d GB, so publishing it back to WordPress.com may fail. Publish a smaller selection of files instead.'
			),
			SYNC_PUSH_SIZE_LIMIT_GB
		);
	} catch {
		// Measuring is advice; the pull has already succeeded.
		return undefined;
	}
}
