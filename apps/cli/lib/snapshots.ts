import { HOUR_MS, DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { Snapshot } from '@studio/common/types/snapshot';
import { __ } from '@wordpress/i18n';
import { addDays, addHours, DurationUnit, formatDuration, intervalToDuration } from 'date-fns';

export {
	getSnapshotsFromConfig,
	saveSnapshotToConfig,
	updateSnapshotInConfig,
	deleteSnapshotFromConfig,
	pruneExpiredOrphanedSnapshots,
} from 'cli/lib/cli-config/snapshots';

export function isSnapshotExpired( snapshot: Snapshot ) {
	const now = new Date();
	const endDate = addDays( snapshot.date, DEMO_SITE_EXPIRATION_DAYS );
	return endDate < now;
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
