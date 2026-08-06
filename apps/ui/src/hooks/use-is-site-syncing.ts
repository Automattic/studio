import { useIsMutating } from '@tanstack/react-query';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
} from '@/data/queries/use-sync-site';

/**
 * Whether a push or pull is in flight for this site, counted across every hook
 * instance rather than one component's own mutation.
 *
 * Sync can be kicked off from several places at once (the site menu, the
 * publish picker, the overview's connections card); each would otherwise report
 * "idle" for work another surface started.
 */
export function useIsSiteSyncing( siteId: string ): { push: boolean; pull: boolean } {
	const push =
		useIsMutating( {
			mutationKey: PUSH_TO_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0;
	const pull =
		useIsMutating( {
			mutationKey: PULL_FROM_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0;
	return { push, pull };
}
