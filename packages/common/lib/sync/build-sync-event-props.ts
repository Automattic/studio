import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import { getSyncType } from '@studio/common/lib/sync/sync-type';
import type {
	TracksSyncFailureReason,
	TracksSyncType,
} from '@studio/common/lib/record-tracks-event';
import type { SyncFailureHint } from '@studio/common/lib/sync/classify-sync-failure';
import type { SyncSite } from '@studio/common/types/sync';

// Kept free of Node imports so the renderers can share these helpers with the
// main process and the `studio ui` server.

// A type alias rather than an interface: interfaces have no implicit index
// signature, so they aren't assignable to the wrappers' `TracksProps`.
export type SyncEventProps = {
	success: boolean;
	sync_type: TracksSyncType;
	time_ms: number;
	failure_reason?: TracksSyncFailureReason;
};

/**
 * The shared prop shape for `studio_sync_push` / `studio_sync_pull`. Sync has
 * three independent implementations (Classic renderer, agentic UI, CLI) with no
 * common code path, so this is what keeps the three emitting identical props
 * instead of drifting apart.
 *
 * `failure_reason` is present only on failures. Cancelled syncs must not reach
 * here at all — they emit no event.
 */
export function buildSyncEventProps( {
	startedAt,
	site,
	error,
	hint,
}: {
	startedAt: number;
	site: Pick< SyncSite, 'isPressable' > | undefined;
	error?: unknown;
	hint?: SyncFailureHint;
} ): SyncEventProps {
	const success = error === undefined;
	return {
		success,
		sync_type: getSyncType( site ),
		time_ms: Date.now() - startedAt,
		...( success ? {} : { failure_reason: classifySyncFailure( error, hint ) } ),
	};
}
