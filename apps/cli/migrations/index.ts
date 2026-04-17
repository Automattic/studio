import { checkStudioCompatibilityForInitialMigration } from './00-check-studio-compatibility';
import { hideStudioDirWindows } from './01-hide-studio-dir-windows';
import { cleanupObsoleteServerFiles } from './02-cleanup-obsolete-server-files';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [
	checkStudioCompatibilityForInitialMigration,
	hideStudioDirWindows,
	cleanupObsoleteServerFiles,
];
