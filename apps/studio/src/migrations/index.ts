import { migrateAppdataMigration } from './00-migrate-appdata-via-cli';
import { migrateFromWpNowFolder } from './01-migrate-from-wp-now-folder';
import { renameLaunchUniquesStat } from './02-rename-launch-uniques-stat';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [
	migrateAppdataMigration,
	migrateFromWpNowFolder,
	renameLaunchUniquesStat,
];
