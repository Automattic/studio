import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

/** The plan and its receipts, where the connector has them (Studio Cloud). */
export function useBilling() {
	const connector = useConnector();
	const { getBilling } = connector;
	return useQuery( {
		queryKey: [ 'billing' ],
		queryFn: () => getBilling!.call( connector ),
		enabled: !! getBilling,
		// A renewal or a cancellation happens on WordPress.com, so opening the panel reads it anew.
		refetchOnMount: 'always',
		meta: { persist: false },
	} );
}
