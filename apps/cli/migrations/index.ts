import { checkStudioCompatibilityForInitialMigration } from './00-check-studio-compatibility';
import { hideStudioDirWindows } from './01-hide-studio-dir-windows';
import { pruneOldPmLogs } from './02-prune-old-pm-logs';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [
	checkStudioCompatibilityForInitialMigration,
	hideStudioDirWindows,
	pruneOldPmLogs,
];
