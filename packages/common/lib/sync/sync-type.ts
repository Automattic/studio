import type { TracksSyncType } from '@studio/common/lib/record-tracks-event';
import type { SyncSite } from '@studio/common/types/sync';

// Kept free of Node imports so the renderers can share these helpers with the
// main process and the `studio ui` server.

/**
 * The `sync_type` Tracks prop for a push/pull: which kind of live site the sync
 * exchanged data with. Pass `undefined` when the connected site isn't known at
 * emit time — a deep-link connection whose site lookup missed builds a
 * placeholder with `isPressable` hardcoded false, and reporting that as `wpcom`
 * would invent a value we never actually observed.
 */
export function getSyncType( site: Pick< SyncSite, 'isPressable' > | undefined ): TracksSyncType {
	if ( ! site ) {
		return 'unknown';
	}
	return site.isPressable ? 'pressable' : 'wpcom';
}
