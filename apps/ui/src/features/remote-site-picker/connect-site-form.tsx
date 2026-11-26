import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import { getSyncType } from '@studio/common/lib/sync/sync-type';
import { getProviderUi } from '@studio/providers/ui';
import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useConnector } from '@/data/core';
import type { ProviderSites, SitesProviderId } from '@studio/providers';

// A site the user describes in the provider's own form, once the provider reached it.
export function ConnectSiteForm( {
	provider,
	siteId,
	disabled = false,
	onSite,
}: {
	provider: SitesProviderId;
	// The local site, when there is one yet.
	siteId?: string;
	disabled?: boolean;
	onSite: ( site: ProviderSites[ SitesProviderId ] ) => Promise< void > | void;
} ) {
	const connector = useConnector();
	const run = useCallback(
		( action: string, input?: Record< string, string > ) =>
			connector.runSitesAction( provider, action, input ),
		[ connector, provider ]
	);
	const connect = useMutation( {
		mutationFn: async ( input: Record< string, string > ) => {
			const site = await connector.resolveRemoteSite( provider, input ).catch( ( error ) => {
				void connector.trackEvent(
					TRACKS_EVENTS.SYNC_CONNECT,
					{
						success: false,
						sync_type: getSyncType( undefined, provider ),
						failure_reason: classifySyncFailure( error ),
					},
					siteId
				);
				throw error;
			} );
			await onSite( site );
		},
	} );

	const { ConnectForm } = getProviderUi( provider );
	return (
		ConnectForm && (
			<ConnectForm
				disabled={ disabled }
				pending={ connect.isPending }
				error={ connect.error?.message }
				onSubmit={ ( input ) => connect.mutate( input ) }
				run={ run }
			/>
		)
	);
}
