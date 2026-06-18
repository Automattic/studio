import {
	getSiteFileAccess,
	SITE_FILE_ACCESS_ALL_FILES,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import {
	getSiteRuntime,
	SITE_RUNTIME_NATIVE_PHP,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { isSameDay } from 'date-fns';
import { bumpStat } from 'cli/lib/bump-stat';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { StatsGroup, StatsMetric } from 'cli/lib/types/bump-stats';

// Composite runtime + file-access metric for the daily active-sites stat.
// Sandbox is always confined to the site directory, so it has no file-access split.
export function getSiteRuntimeStat( site: {
	runtime?: SiteRuntime;
	fileAccess?: SiteFileAccess;
} ): StatsMetric {
	if ( getSiteRuntime( site ) === SITE_RUNTIME_NATIVE_PHP ) {
		return getSiteFileAccess( site ) === SITE_FILE_ACCESS_ALL_FILES
			? StatsMetric.RUNTIME_NATIVE_ALL_FILES
			: StatsMetric.RUNTIME_NATIVE_SITE_DIR;
	}
	return StatsMetric.RUNTIME_SANDBOX;
}

/**
 * Counts a site toward the daily active-sites-by-runtime stat, deduped per site
 * per day so restarts don't inflate the numbers (re-counted when the day rolls
 * over or the runtime/file-access choice changes). Tracked here — the one funnel
 * every site start passes through — so it covers all actions (start,
 * edit-restart, create, import, pull).
 *
 * Intentionally bumped even when the CLI is spawned by the app (i.e. ignoring
 * `--avoid-telemetry`): that flag only distinguishes app-backed runs from direct
 * terminal use, not a user telemetry opt-out. `bumpStat` still no-ops in dev/E2E.
 */
export async function recordSiteRuntimeUsage( site: SiteData ): Promise< void > {
	if ( ! __ENABLE_CLI_TELEMETRY__ ) {
		return;
	}

	const now = Date.now();
	const stat = getSiteRuntimeStat( site );

	try {
		let shouldBump = false;
		try {
			await lockCliConfig();
			const config = await readCliConfig();
			const marker = config.siteRuntimeStats?.[ site.id ];
			const countedTodayForSameRuntime =
				marker !== undefined && isSameDay( marker.bumpedAt, now ) && marker.stat === stat;
			if ( ! countedTodayForSameRuntime ) {
				config.siteRuntimeStats = {
					...config.siteRuntimeStats,
					[ site.id ]: { bumpedAt: now, stat },
				};
				await saveCliConfig( config );
				shouldBump = true;
			}
		} finally {
			await unlockCliConfig();
		}

		if ( shouldBump ) {
			bumpStat( StatsGroup.STUDIO_CLI_RUNTIME_DAILY, stat );
		}
	} catch {
		// Best-effort telemetry — never block or fail a site start.
	}
}
