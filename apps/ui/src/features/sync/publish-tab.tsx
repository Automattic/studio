import { getProvider, getProviderSites, type SitesProviderId } from '@studio/providers';
import { useQueries } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { ChevronLeftIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import {
	remoteSitesQueryKey,
	useConnectedHostingProviders,
	usePublishProviders,
} from '@/data/queries/use-remote-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { getWebsiteThumbnailUrl, RelativeTime, SiteCard } from '@/features/site-card';
import { ChevronRightIcon } from '@/lib/icons';
import { Button } from '@/lib/ui';
import { PublishPanel } from './publish-panel';
import {
	lastPublished,
	siteAddress,
	type PanelRequest,
	type Website,
} from './publish-panel/options';
import { PanelBody } from './publish-panel/parts';
import styles from './publish-tab.module.css';
import type { SiteDetails } from '@/data/core';

export type PublishRequest = {
	view: 'publish' | 'pull';
	// Opens that provider's panel; without one, the tab starts with the published sites.
	provider?: SitesProviderId;
	remoteSiteId?: Website[ 'id' ];
};

type Screen =
	| { kind: 'home' }
	| { kind: 'list' }
	| { kind: 'choose' }
	| { kind: 'provider'; provider: SitesProviderId; request: PanelRequest };

type Published = { provider: SitesProviderId; website: Website };

const PUBLISH: PanelRequest = { view: 'publish' };

export function usePublishTab( siteId: string ) {
	const connector = useConnector();
	const providers = usePublishProviders();
	const preferences = useUserPreferences();
	const { connected, isPending: hostingPending } = useConnectedHostingProviders( providers );
	const saved = preferences.data?.defaultHostingProvider;
	const preferred = saved && connected.includes( saved ) ? saved : undefined;
	const single = providers.length === 1 ? providers[ 0 ] : undefined;
	const defaultHost = preferred ?? ( connected.length === 1 ? connected[ 0 ] : single );
	// Undefined until the tab is first opened, which is when it reads the connections.
	const [ screen, setScreen ] = useState< Screen >();
	const results = useQueries( {
		queries: providers.map( ( provider ) => ( {
			queryKey: remoteSitesQueryKey( provider, siteId ),
			queryFn: () => connector.getRemoteSites( provider, siteId ),
			enabled: screen !== undefined,
		} ) ),
	} );
	const loading = results.some( ( result ) => result.isPending );
	const published: Published[] = providers.flatMap( ( provider, index ) =>
		( results[ index ]?.data ?? [] ).map( ( website ) => ( { provider, website } ) )
	);
	const activity = useSiteSyncActivity( siteId );
	const hasPublished = published.length > 0;

	// Resolve the default when entering setup, before the user picks a destination.
	const home = screen?.kind === 'home';
	const transferProvider =
		activity?.kind === 'pending'
			? ( ( activity.provider ?? 'wpcom' ) as SitesProviderId )
			: undefined;
	const transferSiteId = activity?.kind === 'pending' ? activity.remoteSiteId : undefined;
	useEffect( () => {
		if ( ! home || loading ) return;
		if ( transferProvider && transferSiteId !== undefined ) {
			setScreen( {
				kind: 'provider',
				provider: transferProvider,
				request: { view: 'publish', remoteSiteId: transferSiteId },
			} );
		} else if ( hasPublished ) {
			setScreen( { kind: 'list' } );
		} else if ( single || ( ! preferences.isPending && ! hostingPending ) ) {
			setScreen(
				defaultHost
					? { kind: 'provider', provider: defaultHost, request: PUBLISH }
					: { kind: 'choose' }
			);
		}
	}, [
		home,
		loading,
		hasPublished,
		defaultHost,
		hostingPending,
		preferences.isPending,
		single,
		transferProvider,
		transferSiteId,
	] );

	// With nothing published, the list gives way to the choice of where to publish.
	const current: Screen | 'loading' | undefined =
		screen?.kind !== 'home' && screen?.kind !== 'list'
			? screen
			: loading || home
			? 'loading'
			: hasPublished
			? screen
			: single
			? { kind: 'provider', provider: single, request: PUBLISH }
			: { kind: 'choose' };
	return {
		providers,
		published,
		screen: current,
		provider: typeof current === 'object' && current.kind === 'provider' ? current.provider : null,
		canChooseHost: providers.length > 1,
		canGoBack: hasPublished,
		open: useCallback(
			( request?: PublishRequest ) =>
				setScreen(
					request?.provider
						? {
								kind: 'provider',
								provider: request.provider,
								request: { view: request.view, remoteSiteId: request.remoteSiteId },
						  }
						: { kind: 'home' }
				),
			[]
		),
		showSite: ( provider: SitesProviderId, remoteSiteId: Website[ 'id' ] ) =>
			setScreen( { kind: 'provider', provider, request: { view: 'publish', remoteSiteId } } ),
		chooseHost: () => setScreen( { kind: 'choose' } ),
		choose: ( provider: SitesProviderId ) =>
			setScreen( {
				kind: 'provider',
				provider,
				request: PUBLISH,
			} ),
		back: () => setScreen( { kind: 'list' } ),
	};
}

type PublishTabState = ReturnType< typeof usePublishTab >;

function BackButton( { label, onClick }: { label: string; onClick: () => void } ) {
	return (
		<Button variant="inline-text" size="inline" className={ styles.back } onClick={ onClick }>
			<ChevronLeftIcon aria-hidden="true" />
			{ label }
		</Button>
	);
}

function PublishedSites( {
	tab,
	siteId,
	open,
}: {
	tab: PublishTabState;
	siteId: string;
	open: boolean;
} ) {
	const activity = useSiteSyncActivity( siteId );
	return (
		<PanelBody insetTop>
			<h2 className={ styles.heading }>{ __( 'Published to' ) }</h2>
			<ul className={ styles.sites }>
				{ tab.published.map( ( { provider, website } ) => {
					const address = siteAddress( website );
					const { label } = getProvider( provider );
					const transfer =
						activity?.kind === 'pending' &&
						( activity.provider ?? 'wpcom' ) === provider &&
						activity.remoteSiteId === website.id
							? activity
							: null;
					const updatedAt = lastPublished( website );
					return (
						<li key={ `${ provider }:${ website.id }` } className={ styles.site }>
							<SiteCard
								title={ address }
								thumbnailUrl={ getWebsiteThumbnailUrl( website.url ) }
								description={
									<>
										{ label }
										{ ' · ' }
										{ transfer ? (
											transfer.direction === 'pull' ? (
												__( 'Pulling…' )
											) : (
												__( 'Publishing…' )
											)
										) : updatedAt ? (
											<RelativeTime
												timestamp={ updatedAt }
												active={ open }
												compact
												/* translators: %s: relative time since the site was updated. */
												formatLabel={ ( time ) => sprintf( __( 'Updated %s' ), time ) }
											/>
										) : (
											__( 'Not published yet' )
										) }
									</>
								}
								actions={ <ChevronRightIcon className={ styles.chevron } aria-hidden="true" /> }
								active={ open }
							/>
							<button
								type="button"
								className={ styles.siteButton }
								aria-label={ address }
								aria-description={ label }
								onClick={ () => tab.showSite( provider, website.id ) }
							/>
						</li>
					);
				} ) }
			</ul>
		</PanelBody>
	);
}

function DestinationPicker( { tab }: { tab: PublishTabState } ) {
	return (
		<PanelBody insetTop>
			{ tab.published.length ? (
				<BackButton label={ __( 'Published sites' ) } onClick={ tab.back } />
			) : null }
			<h2 className={ styles.heading }>{ __( 'Where do you want to publish?' ) }</h2>
			<ul className={ styles.options }>
				{ tab.providers.map( ( provider ) => {
					const { label } = getProvider( provider );
					const { intro } = getProviderSites( provider );
					return (
						<li key={ provider }>
							<Button
								variant="outline"
								size="lg"
								className={ styles.option }
								onClick={ () => tab.choose( provider ) }
							>
								<span className={ styles.optionText }>
									<span className={ styles.optionLabel }>{ label }</span>
									<span className={ styles.optionDescription }>{ intro.description() }</span>
								</span>
								<ChevronRightIcon aria-hidden="true" />
							</Button>
						</li>
					);
				} ) }
			</ul>
		</PanelBody>
	);
}

export function PublishTab( {
	tab,
	site,
	open,
	headerContainer,
	substep,
	onSubstepChange,
	setupAfterSignup,
	onSetupAfterSignup,
}: {
	tab: PublishTabState;
	site: SiteDetails;
	open: boolean;
	headerContainer: HTMLDivElement | null;
	substep: boolean;
	onSubstepChange: ( active: boolean ) => void;
	setupAfterSignup: boolean;
	onSetupAfterSignup: () => void;
} ) {
	const { screen } = tab;
	if ( ! screen ) return null;
	if ( screen === 'loading' ) return <PanelBody insetTop loading />;
	if ( screen.kind === 'list' )
		return <PublishedSites tab={ tab } siteId={ site.id } open={ open } />;
	if ( screen.kind !== 'provider' ) return <DestinationPicker tab={ tab } />;
	return (
		<div className={ styles.screen }>
			{ ! substep && tab.canGoBack ? (
				<BackButton label={ __( 'Published sites' ) } onClick={ tab.back } />
			) : null }
			{ ! substep && tab.canChooseHost && screen.request.remoteSiteId === undefined ? (
				<BackButton label={ __( 'Choose another host' ) } onClick={ tab.chooseHost } />
			) : null }
			<PublishPanel
				key={ `${ screen.provider }:${ screen.request.view }:${
					screen.request.remoteSiteId ?? ''
				}` }
				provider={ screen.provider }
				site={ site }
				open={ open }
				request={ screen.request }
				headerContainer={ headerContainer }
				onSubstepChange={ onSubstepChange }
				onDisconnected={ tab.back }
				setupAfterSignup={ setupAfterSignup }
				onSetupAfterSignup={ onSetupAfterSignup }
			/>
		</div>
	);
}
