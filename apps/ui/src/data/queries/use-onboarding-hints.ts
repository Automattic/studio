import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { ChecklistItemId, Connector, OnboardingHintsState } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

// Persisted first-run onboarding state (orientation tour + getting-started
// checklist). Backed by the connector: desktop → app.json, hosted/web →
// localStorage. Read once and kept forever — writes are rare and go through the
// optimistic mutation (or the imperative helper below, for event watchers).

export const ONBOARDING_HINTS_QUERY_KEY = [ 'onboarding-hints' ] as const;
export const ONBOARDING_COMPLETED_QUERY_KEY = [ 'onboarding-completed' ] as const;

export function useOnboardingHints() {
	const connector = useConnector();
	return useQuery( {
		queryKey: ONBOARDING_HINTS_QUERY_KEY,
		queryFn: () => connector.getOnboardingHints(),
		staleTime: Infinity,
		meta: { persist: false },
	} );
}

// Whether the user has finished (or skipped) the pre-workbench welcome. Used
// by the getting-started card so it never appears mid-NUX.
export function useOnboardingCompleted() {
	const connector = useConnector();
	return useQuery( {
		queryKey: ONBOARDING_COMPLETED_QUERY_KEY,
		queryFn: () => connector.getOnboardingCompleted(),
		staleTime: Infinity,
	} );
}

// Shallow-merge a partial into the cached hints, merging completedItems by key
// so a checklist completion never clobbers a concurrent one.
function mergeHints(
	current: OnboardingHintsState | undefined,
	partial: Partial< OnboardingHintsState >
): OnboardingHintsState {
	return {
		...( current ?? {} ),
		...partial,
		completedItems: {
			...( current?.completedItems ?? {} ),
			...( partial.completedItems ?? {} ),
		},
	};
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
				( current: OnboardingHintsState | undefined ) => mergeHints( current, partial )
			);
		},
	} );
}

/**
 * Imperative equivalent of the mutation, for the completion watchers in
 * use-onboarding-events — they're side effects that fire from mutation
 * callbacks, store subscriptions, and route changes, so they shouldn't be
 * coupled to a component's render. No-ops when the item is already recorded.
 */
export async function markChecklistItemComplete(
	connector: Connector,
	queryClient: QueryClient,
	itemId: ChecklistItemId
): Promise< void > {
	const current = queryClient.getQueryData< OnboardingHintsState >( ONBOARDING_HINTS_QUERY_KEY );
	if ( current?.completedItems?.[ itemId ] ) {
		return;
	}
	const partial: Partial< OnboardingHintsState > = {
		completedItems: { [ itemId ]: new Date().toISOString() },
	};
	queryClient.setQueryData(
		ONBOARDING_HINTS_QUERY_KEY,
		( existing: OnboardingHintsState | undefined ) => mergeHints( existing, partial )
	);
	await connector.setOnboardingHints( partial );
}

/** Imperative single-field write for watchers/menus outside React render. */
export async function writeOnboardingHints(
	connector: Connector,
	queryClient: QueryClient,
	partial: Partial< OnboardingHintsState >
): Promise< void > {
	queryClient.setQueryData(
		ONBOARDING_HINTS_QUERY_KEY,
		( existing: OnboardingHintsState | undefined ) => mergeHints( existing, partial )
	);
	await connector.setOnboardingHints( partial );
}
