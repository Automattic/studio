import {
	getProvider,
	getProviderSites,
	type ProviderSites,
	type SitesProviderId,
} from '@studio/providers';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useConnector } from '@/data/core';
import {
	remotePublishTargetKey,
	remoteSitesQueryKey,
	usePickableSitesByProvider,
} from '@/data/queries/use-remote-sites';
import { RemoteSitePicker, RemoteSiteCard } from '@/features/remote-site-picker';
import { Button, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, Spinner } from '@/lib/ui';
import styles from './existing-site-dialog.module.css';
import { ProviderLogo } from './provider-logo';

type ExistingSite = { provider: SitesProviderId; site: ProviderSites[ SitesProviderId ] };

export function ExistingSiteDialog( {
	providers,
	siteId,
	onClose,
	onConnected,
	returnFocus,
}: {
	providers: SitesProviderId[];
	siteId: string;
	onClose: () => void;
	onConnected: ( provider: SitesProviderId, id: string | number ) => void;
	returnFocus: React.RefObject< HTMLButtonElement | null >;
} ) {
	const connector = useConnector();
	const client = useQueryClient();
	const sitesByProvider = usePickableSitesByProvider( providers );
	const connect = useMutation( {
		mutationFn: ( { provider, site }: ExistingSite ) =>
			connector.connectRemoteSite( provider, siteId, site ),
		onSuccess: async ( _, { provider, site } ) => {
			await Promise.all( [
				client.invalidateQueries( { queryKey: remoteSitesQueryKey( provider, siteId ) } ),
				client.invalidateQueries( { queryKey: remoteSitesQueryKey( provider ) } ),
			] );
			onConnected( provider, site.id );
		},
	} );
	const eligible = sitesByProvider.flatMap( ( { provider, data, isFetching } ) =>
		data.map( ( site ) => {
			const descriptor = getProviderSites( provider );
			return {
				provider,
				site,
				key: remotePublishTargetKey( provider, site.id ),
				label: getProvider( provider ).label,
				details: descriptor.describe( site ).details,
				issue: descriptor.issue( site, 'pull' ),
				refreshing: isFetching,
			};
		} )
	);
	const loading = sitesByProvider.some( ( sites ) => sites.isLoading );
	const refreshing = sitesByProvider.some( ( sites ) => sites.isFetching );
	const failed = sitesByProvider.filter( ( sites ) => sites.error );
	const refresh = () => sitesByProvider.forEach( ( sites ) => sites.refetch() );
	const failedConnection = connect.variables;
	const retry =
		connect.error && failedConnection
			? eligible.find(
					( row ) =>
						! row.issue &&
						row.provider === failedConnection.provider &&
						row.site.id === failedConnection.site.id
			  )
			: undefined;

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
					{ loading && <Spinner aria-label={ __( 'Loading websites…' ) } /> }
					{ failed.map( ( { provider } ) => (
						<p role="alert" key={ provider }>
							{ sprintf(
								/* translators: %s is the hosting provider's name. */
								__( 'Could not load %s sites.' ),
								getProvider( provider ).label
							) }
						</p>
					) ) }
					{ connect.error && <p role="alert">{ connect.error.message }</p> }
					{ eligible.length > 0 && (
						<RemoteSitePicker
							items={ eligible }
							getKey={ ( row ) => row.key }
							getSearchText={ ( { site, label, details } ) =>
								[ site.name, site.url, label, ...details.map( ( detail ) => detail.value ) ].join(
									' '
								)
							}
							isAvailable={ ( row ) => ! row.issue }
							availableDescription={ __( 'Select a site to connect to your local WordPress.' ) }
							refreshing={ refreshing }
							disabled={ connect.isPending }
							onRefresh={ refresh }
							renderItem={ ( { provider, site, label, details, issue, refreshing } ) => (
								<RemoteSiteCard
									name={ site.name || new URL( site.url ).hostname }
									url={ site.url }
									icon={ <ProviderLogo provider={ provider } compact /> }
									description={ label }
									disabled={ connect.isPending || refreshing || !! issue }
									onSelect={ () => connect.mutate( { provider, site } ) }
									badges={ details.map( ( detail ) => (
										<Badge key={ detail.title } variant="secondary">
											{ detail.value }
										</Badge>
									) ) }
								>
									{ issue && <p>{ issue }</p> }
								</RemoteSiteCard>
							) }
						/>
					) }
					{ ! loading && eligible.length === 0 && failed.length === 0 && (
						<p>{ __( 'No existing sites.' ) }</p>
					) }
					{ ( retry || ( ! loading && eligible.length === 0 ) ) && (
						<Button
							variant="outline"
							disabled={ connect.isPending || refreshing }
							onClick={ () => ( retry ? connect.mutate( retry ) : refresh() ) }
						>
							{ retry || failed.length ? __( 'Try again' ) : __( 'Refresh' ) }
						</Button>
					) }
				</div>
			</DialogContent>
		</Dialog>
	);
}
