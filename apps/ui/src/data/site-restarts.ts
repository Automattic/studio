import { useIsMutating, useMutationState } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

export const RESTART_SITE_MUTATION_KEY = [ 'restartSite' ] as const;

export function isSiteRestarting( queryClient: QueryClient | undefined, siteId: string ) {
	return (
		( queryClient?.isMutating( {
			mutationKey: RESTART_SITE_MUTATION_KEY,
			predicate: ( mutation ) => mutation.state.variables === siteId,
		} ) ?? 0 ) > 0
	);
}

export function useIsSiteRestarting( siteId: string | undefined ) {
	return (
		useIsMutating( {
			mutationKey: RESTART_SITE_MUTATION_KEY,
			predicate: ( mutation ) => mutation.state.variables === siteId,
		} ) > 0
	);
}

export function getSiteRestartId( queryClient: QueryClient, siteId: string ) {
	const mutations = queryClient.getMutationCache().findAll( {
		mutationKey: RESTART_SITE_MUTATION_KEY,
		predicate: ( mutation ) => mutation.state.variables === siteId,
	} );
	return mutations[ mutations.length - 1 ]?.mutationId;
}

export function useSiteRestartStates() {
	return useMutationState( {
		filters: { mutationKey: RESTART_SITE_MUTATION_KEY },
		select: ( mutation ) => ( { id: mutation.mutationId, status: mutation.state.status } ),
	} );
}
