import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';

export const TOP_UP_PRICING_QUERY_KEY = [ 'top-up-pricing' ] as const;

/**
 * AI credit top-up options priced for the signed-in account (STU-2326).
 * Resolves `undefined` while loading and `null` when pricing is unavailable —
 * callers must render something for both rather than an empty button row.
 */
export function useStudioAssistantTopUpPricing( { enabled = true }: { enabled?: boolean } = {} ) {
	const connector = useConnector();
	const { data: authUser } = useAuthUser();
	const query = useQuery( {
		// Prices are per-account (currency), so an account switch must never
		// reuse the previous account's cached row.
		queryKey: [ ...TOP_UP_PRICING_QUERY_KEY, authUser?.id ],
		queryFn: () => connector.getStudioAssistantTopUpPricing(),
		enabled: enabled && !! authUser,
		// A price list changes on the order of releases, not sessions.
		staleTime: 60 * 60 * 1000,
		meta: { persist: false },
	} );
	return { ...query, data: authUser ? query.data : undefined };
}
