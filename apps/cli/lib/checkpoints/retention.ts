import type { CheckpointIndex, CheckpointIndexEntry } from './manifest';

// Retention policy: manual and agent checkpoints are kept until explicitly
// deleted; automatic checkpoints are pruned by count per trigger type.
// Pinned entries (a restore in flight) are never pruned.
export const DEFAULT_MAX_AUTO_CHECKPOINTS = 10;
export const DEFAULT_MAX_PRE_RESTORE_CHECKPOINTS = 5;

export interface RetentionPolicy {
	maxAutoPerSite: number;
	maxPreRestorePerSite: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
	maxAutoPerSite: DEFAULT_MAX_AUTO_CHECKPOINTS,
	maxPreRestorePerSite: DEFAULT_MAX_PRE_RESTORE_CHECKPOINTS,
};

// Returns the index entries that should be removed under the policy. The
// index is ordered oldest → newest; we keep the newest N of each pruned type.
export function selectPrunableCheckpoints(
	index: CheckpointIndex,
	policy: RetentionPolicy = DEFAULT_RETENTION_POLICY
): CheckpointIndexEntry[] {
	const prunable: CheckpointIndexEntry[] = [];

	for ( const [ trigger, max ] of [
		[ 'auto-pre-tool', policy.maxAutoPerSite ],
		[ 'pre-restore', policy.maxPreRestorePerSite ],
	] as const ) {
		const candidates = index.checkpoints.filter(
			( entry ) => entry.trigger === trigger && ! entry.pinned
		);
		if ( candidates.length > max ) {
			prunable.push( ...candidates.slice( 0, candidates.length - max ) );
		}
	}

	return prunable;
}
