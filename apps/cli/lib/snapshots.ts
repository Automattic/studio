import { HOUR_MS, DAY_MS } from '@studio/common/constants';
import { getSnapshotExpiry } from '@studio/common/lib/snapshots';
import { __ } from '@wordpress/i18n';
import { addHours } from 'date-fns/addHours';
import { formatDuration } from 'date-fns/formatDuration';
import { intervalToDuration } from 'date-fns/intervalToDuration';
import { reconcilePreviews } from 'cli/lib/cli-config/snapshots';
import { getStandingPreviews } from 'cli/lib/preview-sites';
import type { Snapshot } from '@studio/common/types/snapshot';
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
 * Brings saved previews in line with WordPress.com: drops those that ended there, so Studio does not
 * list or try to update them, and takes each one's expiry from the server. Best effort: when the
 * server cannot be asked, the saved list stands.
 */
export async function syncPreviewsWithServer( userId: number, token: string ): Promise< void > {
	const checkedAt = Date.now();
	let standing: Map< number, number | undefined >;
	try {
		standing = await getStandingPreviews( token );
	} catch {
		return;
	}
	await reconcilePreviews( userId, standing, checkedAt );
}

export function formatDurationUntilExpiry( snapshot: Snapshot ) {
	const now = new Date();
	const endDate = new Date( getSnapshotExpiry( snapshot ) );
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
