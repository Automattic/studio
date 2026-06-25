import {
	__bumpAggregatedUniqueStat,
	__bumpStat,
	type LastBumpStatsProvider,
} from '@studio/common/lib/bump-stat';

/**
 * Studio Code agent usage stats, shared between the desktop app and the
 * `studio ui` server. Same bumping logic for both; the surface picks which stat
 * group is bumped so the two never conflate in dashboards. The desktop surface
 * keeps its established `studio-code-ui-*` groups; `studio ui` (the CLI-served
 * UI) uses `studio-code-cliui-*` (kept ≤27 chars, the backend's group limit).
 *
 * The weekly/monthly *unique* stats need a per-host store for their dedup state
 * (the desktop uses app.json, the CLI uses cli.json), so the host passes its
 * `LastBumpStatsProvider`. Without one, only the non-aggregated counts are sent.
 */

export type AgentSurface = 'desktop' | 'cliui';

interface AgentStatGroups {
	send: string;
	run: string;
	weeklyUnique: string;
	monthlyUnique: string;
}

const STAT_GROUPS: Record< AgentSurface, AgentStatGroups > = {
	desktop: {
		send: 'studio-code-ui-send',
		run: 'studio-code-ui-run',
		weeklyUnique: 'studio-code-ui-wk-unq',
		monthlyUnique: 'studio-code-ui-mon-unq',
	},
	cliui: {
		send: 'studio-code-cliui-send',
		run: 'studio-code-cliui-run',
		weeklyUnique: 'studio-code-cliui-wk-unq',
		monthlyUnique: 'studio-code-cliui-mon-unq',
	},
};

export function getPlatformMetric(): string {
	switch ( process.platform ) {
		case 'darwin':
			return 'darwin';
		case 'linux':
			return 'linux';
		case 'win32':
			return 'win32';
		default:
			return 'unknown-platform';
	}
}

// One agent message was sent: a usage count plus weekly/monthly unique-user
// approximations (the latter only when a dedup-state provider is supplied).
export function recordAgentSend(
	surface: AgentSurface,
	lastBumpStatsProvider?: LastBumpStatsProvider
): void {
	const groups = STAT_GROUPS[ surface ];
	const platform = getPlatformMetric();
	__bumpStat( groups.send, platform );
	if ( lastBumpStatsProvider ) {
		void __bumpAggregatedUniqueStat(
			groups.weeklyUnique,
			platform,
			'weekly',
			lastBumpStatsProvider
		).catch( () => undefined );
		void __bumpAggregatedUniqueStat(
			groups.monthlyUnique,
			platform,
			'monthly',
			lastBumpStatsProvider
		).catch( () => undefined );
	}
}

// A run finished: record its outcome.
export function recordAgentRun(
	surface: AgentSurface,
	outcome: { interrupted: boolean; code: number | null }
): void {
	const metric = outcome.interrupted ? 'interrupted' : outcome.code === 0 ? 'success' : 'failure';
	__bumpStat( STAT_GROUPS[ surface ].run, metric );
}
