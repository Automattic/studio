import { migrateFromWpNowFolder } from './00-migrate-from-wp-now-folder';
import { renameLaunchUniquesStat } from './01-rename-launch-uniques-stat';
import { migrateAppConfig } from './02-migrate-to-split-config';
import { copyHttpsCertsToWellKnown } from './03-copy-https-certs-to-well-known';
import { copyServerFilesToWellKnown } from './04-copy-server-files-to-well-known';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [
	migrateAppConfig,
	migrateFromWpNowFolder,
	renameLaunchUniquesStat,
	copyHttpsCertsToWellKnown,
	copyServerFilesToWellKnown,
];
