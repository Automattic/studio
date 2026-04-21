import { isSupportedLocale } from '@studio/common/lib/locale';
import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { SupportedLocale } from '@studio/common/lib/locale';

const USER_LOCALE_QUERY_KEY = [ 'userLocale' ] as const;

/**
 * Resolves the current UI locale so components can render locale-aware links
 * (docs, blog, etc). Returns `undefined` until the connector has responded,
 * and `undefined` for any locale that isn't in our translation catalog.
 */
export function useUserLocale(): SupportedLocale | undefined {
	const connector = useConnector();
	const { data } = useQuery( {
		queryKey: USER_LOCALE_QUERY_KEY,
		queryFn: () => connector.getUserLocale(),
		staleTime: Infinity,
	} );
	if ( ! data || ! isSupportedLocale( data ) ) return undefined;
	return data;
}
