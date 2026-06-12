import { type SiteFileAccess } from '@studio/common/lib/site-file-access';
import { type SiteRuntime } from '@studio/common/lib/site-runtime';
import { isSameWeek } from 'date-fns';
import { bumpStat, getSiteRuntimeStat, StatsGroup } from 'src/lib/bump-stats';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

interface SiteRuntimeUsage {
	id: string;
	runtime?: SiteRuntime;
	fileAccess?: SiteFileAccess;
}

/**
 * Counts a site toward the weekly active-sites-by-runtime stat, deduped to once
 * per site per week so successive restarts don't inflate the numbers. The
 * per-site marker lives in `app.json`'s site metadata.
 */
export async function recordSiteRuntimeUsage( site: SiteRuntimeUsage ): Promise< void > {
	const now = Date.now();
	let shouldBump = false;

	try {
		await lockAppdata();
		const userData = await loadUserData();
		const metadata = userData.siteMetadata[ site.id ];
		if ( ! metadata?.runtimeStatBumpedAt || ! isSameWeek( metadata.runtimeStatBumpedAt, now ) ) {
			userData.siteMetadata[ site.id ] = { ...metadata, runtimeStatBumpedAt: now };
			await saveUserData( userData );
			shouldBump = true;
		}
	} finally {
		await unlockAppdata();
	}

	if ( shouldBump ) {
		bumpStat( StatsGroup.STUDIO_SITE_RUNTIME_WEEKLY, getSiteRuntimeStat( site ) );
	}
}
