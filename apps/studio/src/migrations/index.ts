import { renameLaunchUniquesStat } from './01-rename-launch-uniques-stat';
import { migrateAppConfig } from './02-migrate-to-split-config';
import { copyHttpsCertsToWellKnown } from './03-copy-https-certs-to-well-known';
import { migrateConnectedSitesToShared } from './04-migrate-connected-sites-to-shared';
import { setCliUserUninstalled } from './05-set-cli-user-uninstalled';
import type { Migration } from '@studio/common/lib/migration';

export const migrations: Migration[] = [
	migrateAppConfig,
	renameLaunchUniquesStat,
	copyHttpsCertsToWellKnown,
	migrateConnectedSitesToShared,
	setCliUserUninstalled,
];
