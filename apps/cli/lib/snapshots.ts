import { HOUR_MS, DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { __ } from '@wordpress/i18n';
import { addDays } from 'date-fns/addDays';
import { addHours } from 'date-fns/addHours';
import { formatDuration } from 'date-fns/formatDuration';
import { intervalToDuration } from 'date-fns/intervalToDuration';
import { pruneEndedPreviews } from 'cli/lib/cli-config/snapshots';
import { getStandingPreviewSiteIds } from 'cli/lib/preview-sites';
import type { DurationUnit } from 'date-fns';

export {
	getSnapshotsFromConfig,
	saveSnapshotToConfig,
	updateSnapshotInConfig,
	deleteSnapshotFromConfig,
	pruneExpiredOrphanedSnapshots,
} from 'cli/lib/cli-config/snapshots';

export { getSnapshotLink, isSnapshotExpired, isWpcomPreview } from '@studio/common/lib/snapshots';

/**
 * Drops saved previews that ended on WordPress.com, so Studio does not list or try to update them.
 * Best effort: when the server cannot be asked, the saved list stands.
 */
export async function syncPreviewsWithServer( userId: number, token: string ): Promise< void > {
	const checkedAt = Date.now();
	let standing: Set< number >;
	try {
		standing = await getStandingPreviewSiteIds( token );
	} catch {
		return;
	}
	await pruneEndedPreviews( userId, standing, checkedAt );
}

export function formatDurationUntilExpiry( lastUpdatedAt: number ) {
	const now = new Date();
	const endDate = addDays( lastUpdatedAt, DEMO_SITE_EXPIRATION_DAYS );
	const difference = endDate.getTime() - now.getTime();
	let format: DurationUnit[] = [ 'days', 'hours' ];

	if ( difference < HOUR_MS ) {
		format = [ 'minutes' ];
	} else if ( difference < DAY_MS ) {
		format = [ 'hours', 'minutes' ];
	}

	if ( endDate < now ) {
		return __( 'Expired' );
	}

	return formatDuration(
		intervalToDuration( {
			start: now,
			end: addHours( endDate, 1 ),
		} ),
		{
			format,
			delimiter: ', ',
		}
	);
}
