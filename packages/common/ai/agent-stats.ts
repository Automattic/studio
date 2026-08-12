import { appBumpStatsProvider } from '@studio/common/lib/app-bump-stats';
import { __bumpAggregatedUniqueStat, __bumpStat } from '@studio/common/lib/bump-stat';
import { captureException } from '@studio/common/lib/error-reporting';

/**
 * Studio Code agent usage stats. The `surface` selects which stat group is
 * bumped so surfaces never conflate in dashboards — desktop uses
 * `studio-code-ui-*`, the CLI-served UI uses `studio-code-cliui-*` (kept ≤27
 * chars, the backend's group limit). Weekly/monthly unique-user dedup state
 * lives in app.json via {@link appBumpStatsProvider}.
 */

export type AgentSurface = 'desktop' | 'cliui';

export const AGENT_SURFACE_ENV_VAR = 'STUDIO_AGENT_SURFACE';

export function isAgentSurface( value: unknown ): value is AgentSurface {
	return value === 'desktop' || value === 'cliui';
}

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

function getPlatformMetric(): string {
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
// approximations.
export function recordAgentSend( surface: AgentSurface ): void {
	const groups = STAT_GROUPS[ surface ];
	const platform = getPlatformMetric();
	__bumpStat( groups.send, platform );
	void __bumpAggregatedUniqueStat(
		groups.weeklyUnique,
		platform,
		'weekly',
		appBumpStatsProvider
	).catch( ( error ) => captureException( error ) );
	void __bumpAggregatedUniqueStat(
		groups.monthlyUnique,
		platform,
		'monthly',
		appBumpStatsProvider
	).catch( ( error ) => captureException( error ) );
}

// A run finished: record its outcome.
export function recordAgentRun(
	surface: AgentSurface,
	outcome: { interrupted: boolean; code: number | null }
): void {
	const metric = outcome.interrupted ? 'interrupted' : outcome.code === 0 ? 'success' : 'failure';
	__bumpStat( STAT_GROUPS[ surface ].run, metric );
}
