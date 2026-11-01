import { PendingWork } from '@studio/agent/shared/pending-work';
import type { SessionManager } from '@earendil-works/pi-coding-agent';

export type { PendingWork };

// Kept per chat session, so what background work reports reaches the agent in
// this turn or a later one.
const pendingWorkBySession = new WeakMap< SessionManager, PendingWork >();

export function getPendingWork( session: SessionManager ): PendingWork {
	let pendingWork = pendingWorkBySession.get( session );
	if ( ! pendingWork ) {
		pendingWork = new PendingWork();
		pendingWorkBySession.set( session, pendingWork );
	}
	return pendingWork;
}
