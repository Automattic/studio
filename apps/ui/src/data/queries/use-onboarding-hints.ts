import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { OnboardingHintsState } from '@/data/core';

// Persisted first-run onboarding state (orientation tour + getting-started
// checklist). Backed by the connector: desktop → app.json, hosted/web →
// localStorage. Read once and kept forever — writes are rare and go through the
// optimistic mutation below.

const ONBOARDING_HINTS_QUERY_KEY = [ 'onboarding-hints' ] as const;

export function useOnboardingHints() {
	const connector = useConnector();
	return useQuery( {
		queryKey: ONBOARDING_HINTS_QUERY_KEY,
		queryFn: () => connector.getOnboardingHints(),
		staleTime: Infinity,
		meta: { persist: false },
	} );
}

export function useSetOnboardingHints() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( partial: Partial< OnboardingHintsState > ) =>
			connector.setOnboardingHints( partial ),
		// Optimistic so the UI reacts immediately; the connector write is the
		// source of truth on next launch.
		onMutate: ( partial ) => {
			queryClient.setQueryData(
				ONBOARDING_HINTS_QUERY_KEY,
				( current: OnboardingHintsState | undefined ) => ( { ...( current ?? {} ), ...partial } )
			);
		},
	} );
}
