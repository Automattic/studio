import { HOUR_MS, DAY_MS } from '@studio/common/constants';
import { getSnapshotExpiry } from '@studio/common/lib/snapshots';
import { __ } from '@wordpress/i18n';
import { addHours } from 'date-fns/addHours';
import { formatDuration } from 'date-fns/formatDuration';
import { intervalToDuration } from 'date-fns/intervalToDuration';
import { reconcilePreviews } from 'cli/lib/cli-config/snapshots';
import { wpcomPreviews } from 'cli/lib/preview-sites';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { PreviewSite } from '@studio/providers';
import type { DurationUnit } from 'date-fns';

export {
	getSnapshotsFromConfig,
	saveSnapshotToConfig,
	updateSnapshotInConfig,
	deleteSnapshotFromConfig,
	pruneExpiredOrphanedSnapshots,
} from 'cli/lib/cli-config/snapshots';

export { getSnapshotLink, isSnapshotExpired } from '@studio/common/lib/snapshots';

/**
 * Brings saved previews in line with WordPress.com: drops those that ended there, so Studio does not
 * list or try to update them, and takes each one's expiry and preview link from the server. Best effort: when the
 * server cannot be asked, the saved list stands.
 *
 * A preview that was bought stays one of the user's sites, where one that expired or was deleted is
 * gone, so a dropped preview still among their sites is connected to the local site it was made
 * from: Publish offers it, and the next preview of that site shows changes to it.
 */
export async function syncPreviewsWithServer( userId: number, token: string ): Promise< void > {
	const checkedAt = Date.now();
	let previews: PreviewSite[];
	try {
		previews = await wpcomPreviews.list( { token } );
	} catch {
		return;
	}
	const forgotten = await reconcilePreviews( userId, previews, checkedAt, { keepMissing: true } );
	if ( ! forgotten.length ) {
		return;
	}
	const sites = await fetchSyncableSites( token, { planRequired: false } ).catch( () => null );
	if ( ! sites ) return;
	await reconcilePreviews( userId, previews, checkedAt, { hostedSites: sites } );
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
