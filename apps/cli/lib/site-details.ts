import { getSiteEmailDirectory } from '@studio/common/sites/site-email';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { getLiveSiteOperation } from 'cli/lib/site-operations';
import type { SiteData } from 'cli/lib/cli-config/core';

// A site as Studio shows it, built once for both `site list` and the events
// Studio applies to its list, so the two can't drift apart.
export function getSiteDetails( site: SiteData ) {
	return {
		...site,
		// Overrides the stored value from `...site`: it can still name a process
		// that has died, and both front ends decide which site actions to disable
		// from what this reports.
		operation: getLiveSiteOperation( site ),
		url: getSiteUrl( site ),
		emailPath: getSiteEmailDirectory( site.id ),
	};
}
