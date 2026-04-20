import { renameLaunchUniquesStat } from './01-rename-launch-uniques-stat';
import { migrateAppConfig } from './02-migrate-to-split-config';
import { copyHttpsCertsToWellKnown } from './03-copy-https-certs-to-well-known';
import { archiveExcessConnectedSites } from './04-archive-excess-connected-sites';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [
	migrateAppConfig,
	renameLaunchUniquesStat,
	copyHttpsCertsToWellKnown,
	archiveExcessConnectedSites,
];
