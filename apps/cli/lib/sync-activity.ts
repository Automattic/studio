import { SYNC_EVENTS } from '@studio/common/lib/cli-events';
import { canCancelSyncActivity } from '@studio/common/lib/sync/cancel';
import { emitCliEvent } from 'cli/lib/daemon-client';
import type { SyncActivity, SyncEvent } from '@studio/common/lib/sync/activity';

let latest: SyncEvent | undefined;

export function reportSyncActivity( siteId: string, activity: SyncActivity ): Promise< void > {
	latest = { siteId, activity };
	return emitCliEvent( { event: SYNC_EVENTS.ACTIVITY, data: latest } );
}

/**
 * Hosts cancel a sync by terminating the CLI process running it. Other SIGTERM listeners suppress
 * Node's default exit, so exit here, unless the sync is past the point where stopping is safe.
 */
export function exitOnCancel(): void {
	process.on( 'SIGTERM', () => {
		if ( ! latest ) {
			process.exit( 1 );
		}
		const { siteId, activity } = latest;
		if ( ! canCancelSyncActivity( activity ) ) {
			return;
		}
		void reportSyncActivity( siteId, { kind: 'cancelled', direction: activity.direction } ).finally(
			() => process.exit( 1 )
		);
	} );
}
