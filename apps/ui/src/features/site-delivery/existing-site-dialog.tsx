import { getSitesDescriptor, type ProviderSites, type SitesProviderId } from '@studio/providers';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useRef } from 'react';
import { useConnector } from '@/data/core';
import { remoteSitesQueryKey, usePickableSites } from '@/data/queries/use-remote-sites';
import { RemoteSitePicker, RemoteSiteCard } from '@/features/remote-site-picker';
import { Button, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, Spinner } from '@/lib/ui';
import styles from './existing-site-dialog.module.css';

export function ExistingSiteDialog< Id extends SitesProviderId >( {
	provider,
	siteId,
	onClose,
	onConnected,
	returnFocus,
}: {
	provider: Id;
	siteId: string;
	onClose: () => void;
	onConnected: ( id: ProviderSites[ Id ][ 'id' ] ) => void;
	returnFocus: React.RefObject< HTMLButtonElement | null >;
} ) {
	const connector = useConnector();
	const client = useQueryClient();
	const connectTrigger = useRef< string >( undefined );
	const sites = usePickableSites( provider );
	const descriptor = getSitesDescriptor( provider );
	const connect = useMutation( {
		mutationFn: ( site: ProviderSites[ Id ] ) =>
			connector.connectRemoteSite( provider, siteId, site ),
		onSuccess: async ( _, site ) => {
			await Promise.all( [
				client.invalidateQueries( { queryKey: remoteSitesQueryKey( provider, siteId ) } ),
				client.invalidateQueries( { queryKey: remoteSitesQueryKey( provider ) } ),
			] );
			onConnected( site.id );
		},
	} );
	const eligible = sites.data ?? [];
	return (
		<Dialog open onOpenChange={ ( open ) => ! open && ! connect.isPending && onClose() }>
			<DialogContent
				className={ styles.dialog }
				closeButtonDisabled={ connect.isPending }
				finalFocus={ returnFocus }
			>
				<DialogHeader>
					<DialogTitle>{ __( 'Choose an existing site' ) }</DialogTitle>
				</DialogHeader>
				<div className={ styles.body }>
					{ sites.isLoading ? <Spinner aria-label={ __( 'Loading websites…' ) } /> : null }
					{ sites.error || connect.error ? (
						<p role="alert">{ connect.error?.message ?? __( 'Could not load existing sites.' ) }</p>
					) : null }
					{ ! sites.isLoading &&
						! sites.error &&
						( eligible.length ? (
							<RemoteSitePicker
								items={ eligible }
								getKey={ ( site ) => site.id }
								getSearchText={ ( site ) =>
									`${ site.name } ${ site.url } ${ descriptor
										.details( site )
										.map( ( detail ) => detail.value )
										.join( ' ' ) }`
								}
								isAvailable={ ( site ) => ! descriptor.issue( site, 'pull' ) }
								availableDescription={ __( 'Select a site to connect to your local WordPress.' ) }
								refreshing={ sites.isFetching }
								disabled={ connect.isPending }
								onRefresh={ () => sites.refetch() }
								renderItem={ ( site ) => (
									<RemoteSiteCard
										name={ site.name || new URL( site.url ).hostname }
										url={ site.url }
										disabled={
											connect.isPending || sites.isFetching || !! descriptor.issue( site, 'pull' )
										}
										onSelect={ () => {
											connectTrigger.current = String( site.id );
											connect.mutate( site );
										} }
										badges={ descriptor.details( site ).map( ( detail ) => (
											<Badge key={ detail.title } variant="secondary">
												{ detail.value }
											</Badge>
										) ) }
									>
										{ descriptor.issue( site, 'pull' ) && (
											<p>{ descriptor.issue( site, 'pull' ) }</p>
										) }
									</RemoteSiteCard>
								) }
							/>
						) : (
							<p>{ __( 'No existing sites.' ) }</p>
						) ) }
					{ ( sites.error || connect.error || eligible.length === 0 ) && (
						<Button
							variant="outline"
							disabled={ connect.isPending || sites.isFetching }
							onClick={ () => {
								const retry =
									connect.error &&
									eligible.find( ( site ) => String( site.id ) === connectTrigger.current );
								if ( retry ) connect.mutate( retry );
								else sites.refetch();
							} }
						>
							{ sites.error || connect.error ? __( 'Try again' ) : __( 'Refresh' ) }
						</Button>
					) }
				</div>
			</DialogContent>
		</Dialog>
	);
}
