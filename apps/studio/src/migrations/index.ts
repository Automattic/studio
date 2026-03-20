import { migrateAppConfig } from './00-migrate-to-split-config';
import { migrateFromWpNowFolder } from './01-migrate-from-wp-now-folder';
import { renameLaunchUniquesStat } from './02-rename-launch-uniques-stat';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [
	migrateAppConfig,
	migrateFromWpNowFolder,
	renameLaunchUniquesStat,
];
