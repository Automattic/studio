import { getStaffAdminLogin } from '@studio/common/lib/curate-admin';
import { getSiteEmailDirectory } from '@studio/common/sites/site-email';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { isPhpMyAdminSupported } from 'cli/lib/native-php/phpmyadmin';
import { getLiveSiteOperation } from 'cli/lib/site-operations';
import type { ConfigSite } from '@studio/common/lib/config/schema';

// A site as Studio shows it, built once for both `site list` and the events
// Studio applies to its list, so the two can't drift apart.
export function getSiteDetails( {
	connections: _connections,
	runtimeStat: _runtimeStat,
	...site
}: ConfigSite ) {
	return {
		...site,
		// Overrides the stored value from `...site`: it can still name a process
		// that has died, and both front ends decide which site actions to disable
		// from what this reports.
		operation: getLiveSiteOperation( site ),
		url: getSiteUrl( site ),
		emailPath: getSiteEmailDirectory( site.id ),
		staffAdmin: getStaffAdminLogin( site.path ),
		phpMyAdminSupported: isPhpMyAdminSupported( site ),
	};
}
