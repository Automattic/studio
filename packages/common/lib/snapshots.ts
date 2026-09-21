import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import type { Snapshot } from '@studio/common/types/snapshot';

export function isSnapshotExpired( snapshot: Snapshot ): boolean {
	return snapshot.date + DEMO_SITE_EXPIRATION_DAYS * DAY_MS < Date.now();
}
