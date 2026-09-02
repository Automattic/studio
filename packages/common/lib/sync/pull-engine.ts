import { readAppConfig } from '@studio/common/lib/app-config';
import type { PullEngine } from '@studio/common/types/sync';

/**
 * Which engine a pull should use, read from the `reprintPull` beta feature the
 * desktop app writes to `app.json`.
 *
 * The agentic UI runs against two backends — the Electron main process and the
 * `studio ui` server — and both have to reach the same answer, so the default
 * for an unset flag lives here rather than in either caller.
 */
export const DEFAULT_PULL_ENGINE: PullEngine = 'jetpack';

export async function resolvePullEngine(): Promise< PullEngine > {
	const betaFeatures = ( await readAppConfig() ).betaFeatures as
		| { reprintPull?: boolean }
		| undefined;
	return betaFeatures?.reprintPull ? 'reprint' : DEFAULT_PULL_ENGINE;
}
