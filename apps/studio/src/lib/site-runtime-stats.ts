import { type SiteFileAccess } from '@studio/common/lib/site-file-access';
import { type SiteRuntime } from '@studio/common/lib/site-runtime';
import { isSameDay } from 'date-fns';
import { bumpStat, getSiteRuntimeStat, StatsGroup } from 'src/lib/bump-stats';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

interface SiteRuntimeUsage {
	id: string;
	runtime?: SiteRuntime;
	fileAccess?: SiteFileAccess;
}

/**
 * Counts a site toward the daily active-sites-by-runtime stat. Deduped per site
 * per day so successive restarts don't inflate the numbers, but re-counted when
 * the day rolls over or the runtime/file-access choice changes (so a switch is
 * captured on the next start rather than at the next day boundary). The per-site
 * marker lives in `app.json`'s site metadata.
 */
export async function recordSiteRuntimeUsage( site: SiteRuntimeUsage ): Promise< void > {
	const now = Date.now();
	const stat = getSiteRuntimeStat( site );
	let shouldBump = false;

	try {
		await lockAppdata();
		const userData = await loadUserData();
		const metadata = userData.siteMetadata[ site.id ];
		const countedTodayForSameRuntime =
			metadata?.runtimeStatBumpedAt !== undefined &&
			isSameDay( metadata.runtimeStatBumpedAt, now ) &&
			metadata.runtimeStat === stat;
		if ( ! countedTodayForSameRuntime ) {
			userData.siteMetadata[ site.id ] = {
				...metadata,
				runtimeStatBumpedAt: now,
				runtimeStat: stat,
			};
			await saveUserData( userData );
			shouldBump = true;
		}
	} finally {
		await unlockAppdata();
	}

	if ( shouldBump ) {
		bumpStat( StatsGroup.STUDIO_SITE_RUNTIME_DAILY, stat );
	}
}
