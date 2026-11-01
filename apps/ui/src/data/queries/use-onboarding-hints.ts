import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { OnboardingHintsState } from '@/data/core';

// Guide progress and first-use tips are shared by Desktop and `studio ui`.
// Writes are rare and update this cache optimistically.

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
		onError: () => queryClient.invalidateQueries( { queryKey: ONBOARDING_HINTS_QUERY_KEY } ),
		onMutate: ( partial ) => {
			queryClient.setQueryData(
				ONBOARDING_HINTS_QUERY_KEY,
				( current: OnboardingHintsState | undefined ) => ( { ...( current ?? {} ), ...partial } )
			);
		},
	} );
}
