import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useSites } from './use-sites';

export const ONBOARDING_COMPLETED_QUERY_KEY = [ 'onboarding-completed' ] as const;

// Whether the first-run welcome shows, `undefined` until known. Users who had
// sites before the flag existed keep it `false`, so a site also means past it.
export function useWelcomeOpen(): boolean | undefined {
	const connector = useConnector();
	const { data: completed } = useQuery( {
		queryKey: ONBOARDING_COMPLETED_QUERY_KEY,
		queryFn: () => connector.getOnboardingCompleted(),
		meta: { persist: false },
	} );
	const { data: sites } = useSites();
	if ( completed || sites?.length ) return false;
	return completed === undefined || sites === undefined ? undefined : true;
}
