import { moveAiSessionsToStudioDir } from '@studio/common/ai/sessions/root-migration';
import { checkStudioCompatibilityForInitialMigration } from './00-check-studio-compatibility';
import { hideStudioDirWindows } from './01-hide-studio-dir-windows';
import { renameProcessManagerHome } from './03-rename-pm-home';
import { cleanupObsoleteServerFiles } from './04-cleanup-obsolete-server-files';
import { migrateConnectedSitesToShared } from './05-migrate-connected-sites-to-shared';
import { installBundledDefaultPhp } from './06-install-bundled-default-php';
import { cleanupOrphanedConnectedSites } from './07-cleanup-orphaned-connected-sites';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [
	checkStudioCompatibilityForInitialMigration,
	hideStudioDirWindows,
	renameProcessManagerHome,
	cleanupObsoleteServerFiles,
	migrateConnectedSitesToShared,
	installBundledDefaultPhp,
	cleanupOrphanedConnectedSites,
	moveAiSessionsToStudioDir,
];
