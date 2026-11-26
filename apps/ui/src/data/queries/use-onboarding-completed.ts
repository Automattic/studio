import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useConnector } from '@/data/core';
import { useSites } from './use-sites';
import type { OnboardingAnalytics } from '@studio/common/lib/auth-tracks';

const ONBOARDING_COMPLETED_QUERY_KEY = [ 'onboarding-completed' ] as const;

function useOnboardingCompleted() {
	const connector = useConnector();
	return useQuery( {
		queryKey: ONBOARDING_COMPLETED_QUERY_KEY,
		queryFn: () => connector.getOnboardingCompleted(),
		meta: { persist: false },
	} );
}

export function useCompleteOnboarding() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useCallback(
		async ( analytics: OnboardingAnalytics ) => {
			await connector.setOnboardingCompleted( true, analytics );
			queryClient.setQueryData( ONBOARDING_COMPLETED_QUERY_KEY, true );
		},
		[ connector, queryClient ]
	);
}

/**
 * Whether the first-run welcome shows, or `undefined` until that is known.
 * Users who had sites before the flag existed keep it `false`, so having a site
 * also means past the welcome.
 */
export function useWelcomeOpen(): boolean | undefined {
	const { data: completed, isError: completedError } = useOnboardingCompleted();
	const { data: sites, isError: sitesError } = useSites();
	if ( completed === true || completedError || sitesError ) return false;
	if ( completed === undefined || sites === undefined ) return undefined;
	return sites.length === 0;
}
