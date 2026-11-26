import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import { getSyncType } from '@studio/common/lib/sync/sync-type';
import { Button, Badge, Spinner } from '@studio/ds';
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
import { ConnectSiteForm, RemoteSitePicker, RemoteSiteCard } from '@/features/remote-site-picker';
import styles from './existing-site-step.module.css';
import { ProviderLogo } from './provider-logo';

type ExistingSite = { provider: SitesProviderId; site: ProviderSites[ SitesProviderId ] };

export const connectExistingSiteKey = ( siteId: string ) => [ 'connect-existing-site', siteId ];

export function ExistingSiteStep( {
	providers,
	availableProviders,
	siteId,
	replacing,
	disabled,
	onConnectProvider,
	onShowConnectForm,
	onConnected,
}: {
	providers: SitesProviderId[];
	availableProviders: SitesProviderId[];
	siteId: string;
	replacing: boolean;
	disabled: boolean;
	onConnectProvider: ( provider: SitesProviderId ) => void;
	// Opens a provider's `sites.connect` form; without it, the forms show here.
	onShowConnectForm?: ( provider: SitesProviderId ) => void;
	onConnected: ( provider: SitesProviderId, id: string | number ) => void;
} ) {
	const connector = useConnector();
	const client = useQueryClient();
	// A provider whose sites the user connects with a form has no list to pick from.
	const listed = providers.filter( ( provider ) => ! getProviderSites( provider ).connect );
	const described = providers.filter( ( provider ) => getProviderSites( provider ).connect );
	const sitesByProvider = usePickableSitesByProvider( listed );
	const connectable = availableProviders.filter( ( provider ) => ! providers.includes( provider ) );
	const connect = useMutation( {
		mutationKey: connectExistingSiteKey( siteId ),
		mutationFn: ( { provider, site }: ExistingSite ) =>
			connector.connectRemoteSite( provider, siteId, site ),
		onSuccess: async ( _, { provider, site } ) => {
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_CONNECT,
				{ success: true, num_of_sites: 1, sync_type: getSyncType( site, provider ) },
				siteId
			);
			await Promise.all( [
				...providers.flatMap( ( id ) => [
					client.invalidateQueries( { queryKey: remoteSitesQueryKey( id, siteId ) } ),
					client.invalidateQueries( { queryKey: remoteSitesQueryKey( id ) } ),
				] ),
			] );
			onConnected( provider, site.id );
		},
		onError: ( error, { provider, site } ) => {
			void connector.trackEvent(
				TRACKS_EVENTS.SYNC_CONNECT,
				{
					success: false,
					sync_type: getSyncType( site, provider ),
					failure_reason: classifySyncFailure( error ),
				},
				siteId
			);
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
				issue: descriptor.issue?.( site, 'pull' ) ?? null,
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
		<div className={ styles.body }>
			{ replacing && (
				<p>
					{ __(
						'Connecting an existing site will disconnect your current destination from WordPress Studio. Its content won’t change.'
					) }
				</p>
			) }
			{ listed.length === 0 && connectable.length > 0 && (
				<>
					<p>{ __( 'Connect a provider to see your existing sites.' ) }</p>
					{ connectable.map( ( provider ) => (
						<Button
							key={ provider }
							variant="outline"
							disabled={ disabled }
							onClick={ () => onConnectProvider( provider ) }
						>
							{ sprintf(
								/* translators: %s: hosting provider name. */
								__( 'Connect to %s' ),
								getProvider( provider ).label
							) }
						</Button>
					) ) }
				</>
			) }
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
			{ connect.error && ! getProviderSites( connect.variables.provider ).connect && (
				<p role="alert">{ connect.error.message }</p>
			) }
			{ eligible.length > 0 && (
				<RemoteSitePicker
					compactControls
					items={ eligible }
					getKey={ ( row ) => row.key }
					getSearchText={ ( { site, label, details } ) =>
						[ site.name, site.url, label, ...details.map( ( detail ) => detail.value ) ].join( ' ' )
					}
					isAvailable={ ( row ) => ! row.issue }
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
							onOpen={ () => void connector.openExternalUrl( site.url ) }
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
			{ listed.length > 0 && ! loading && eligible.length === 0 && failed.length === 0 && (
				<p>{ __( 'No existing sites.' ) }</p>
			) }
			{ ( retry || ( listed.length > 0 && ! loading && eligible.length === 0 ) ) && (
				<Button
					variant="outline"
					disabled={ connect.isPending || refreshing }
					onClick={ () => ( retry ? connect.mutate( retry ) : refresh() ) }
				>
					{ retry || failed.length ? __( 'Try again' ) : __( 'Refresh' ) }
				</Button>
			) }
			{ described.map( ( provider ) =>
				onShowConnectForm ? (
					<Button
						key={ provider }
						variant="outline"
						disabled={ disabled }
						onClick={ () => onShowConnectForm( provider ) }
					>
						{ sprintf(
							/* translators: %s: hosting provider name. */
							__( 'Connect to %s' ),
							getProvider( provider ).label
						) }
					</Button>
				) : (
					<ConnectSiteForm
						key={ provider }
						provider={ provider }
						siteId={ siteId }
						disabled={ disabled || connect.isPending }
						onSite={ ( site ) => connect.mutateAsync( { provider, site } ) }
					/>
				)
			) }
		</div>
	);
}
