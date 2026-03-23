import { migrateFromWpNowFolder } from './00-migrate-from-wp-now-folder';
import { renameLaunchUniquesStat } from './01-rename-launch-uniques-stat';
import { migrateAppConfig } from './02-migrate-to-split-config';
import { copyHttpsCertsToWellKnown } from './03-migrate-https-certificates-to-cli';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [
	migrateAppConfig,
	migrateFromWpNowFolder,
	renameLaunchUniquesStat,
	copyHttpsCertsToWellKnown,
];
