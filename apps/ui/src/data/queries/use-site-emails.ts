import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const siteEmailsQueryKey = ( siteId: string ) => [ 'site-emails', siteId ] as const;

// Nothing tells the UI when a site sends email, so the list is read again on
// this interval while it's on screen.
const NEW_EMAIL_INTERVAL = 2000;

/** The email the site sent, newest first. Polled while `watching`. */
export function useSiteEmails( siteId: string, { watching }: { watching: boolean } ) {
	const connector = useConnector();

	return useQuery( {
		queryKey: siteEmailsQueryKey( siteId ),
		queryFn: () => connector.getSiteEmails( siteId ),
		refetchInterval: watching ? NEW_EMAIL_INTERVAL : false,
		meta: { persist: false },
	} );
}

/** One email in full. A saved email never changes, so it's read once. */
export function useSiteEmail( siteId: string, emailId: string | null ) {
	const connector = useConnector();

	return useQuery( {
		queryKey: [ ...siteEmailsQueryKey( siteId ), emailId ] as const,
		queryFn: () => connector.getSiteEmail( siteId, emailId! ),
		enabled: !! emailId,
		staleTime: Infinity,
		meta: { persist: false },
	} );
}
