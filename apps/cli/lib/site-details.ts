import { omitFrontendSecrets } from '@studio/common/lib/site-frontend';
import { getSiteEmailDirectory } from '@studio/common/sites/site-email';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { isPhpMyAdminSupported } from 'cli/lib/native-php/phpmyadmin';
import { getLiveSiteOperation } from 'cli/lib/site-operations';
import type { SiteData } from 'cli/lib/cli-config/core';

// A site as Studio shows it, built once for both `site list` and the events
// Studio applies to its list, so the two can't drift apart.
export function getSiteDetails( site: SiteData ) {
	return {
		...site,
		// The frontend's preview and revalidation secrets never leave the CLI.
		...( site.frontend && { frontend: omitFrontendSecrets( site.frontend ) } ),
		// Overrides the stored value from `...site`: it can still name a process
		// that has died, and both front ends decide which site actions to disable
		// from what this reports.
		operation: getLiveSiteOperation( site ),
		url: getSiteUrl( site ),
		emailPath: getSiteEmailDirectory( site.id ),
		phpMyAdminSupported: isPhpMyAdminSupported( site ),
	};
}
