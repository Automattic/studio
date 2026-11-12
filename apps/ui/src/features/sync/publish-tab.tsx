import {
	getProviderDescriptor,
	getSitesDescriptor,
	SITES_PROVIDER_IDS,
	type SitesProviderId,
} from '@studio/providers';
import { useQueries } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import { remoteSitesQueryKey } from '@/data/queries/use-remote-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { getWebsiteThumbnailUrl, RelativeTime, SiteCard } from '@/features/site-card';
import { PlusIcon } from '@/lib/icons';
import { Button } from '@/lib/ui';
import { PublishPanel } from './publish-panel';
import { lastPublished, type PanelRequest, type Website } from './publish-panel/options';
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
const ADD: PanelRequest = { view: 'start' };

// The providers a site can be published to here: one that publishes a static export needs the
// site to run on native PHP.
function usePublishProviders(): SitesProviderId[] {
	const connector = useConnector();
	return SITES_PROVIDER_IDS.filter(
		( id ) => connector.capabilities.nativeSites || ! getSitesDescriptor( id ).exportsStaticSite
	);
}

export function usePublishTab( siteId: string ) {
	const connector = useConnector();
	const providers = usePublishProviders();
	const results = useQueries( {
		queries: providers.map( ( provider ) => ( {
			queryKey: remoteSitesQueryKey( provider, siteId ),
			queryFn: () => connector.getRemoteSites( provider, siteId ),
		} ) ),
	} );
	const loading = results.some( ( result ) => result.isPending );
	const published: Published[] = providers.flatMap( ( provider, index ) =>
		( results[ index ]?.data ?? [] ).map( ( website ) => ( { provider, website } ) )
	);
	const activity = useSiteSyncActivity( siteId );
	const transfer =
		activity?.kind === 'pending' && activity.remoteSiteId !== undefined ? activity : null;
	// Undefined until the tab is first opened.
	const [ screen, setScreen ] = useState< Screen >();
	const single = providers.length === 1 ? providers[ 0 ] : undefined;
	const fallback: Screen = single
		? { kind: 'provider', provider: single, request: PUBLISH }
		: { kind: 'choose' };

	// The tab opens on the transfer under way, else on the published sites.
	const home = screen?.kind === 'home';
	const hasPublished = published.length > 0;
	const transferProvider = transfer
		? ( ( transfer.provider ?? 'wpcom' ) as SitesProviderId )
		: undefined;
	const transferSiteId = transfer?.remoteSiteId;
	useEffect( () => {
		if ( ! home || loading ) return;
		setScreen(
			transferProvider && transferSiteId !== undefined
				? {
						kind: 'provider',
						provider: transferProvider,
						request: { view: 'publish', remoteSiteId: transferSiteId },
				  }
				: hasPublished || ! single
				? { kind: hasPublished ? 'list' : 'choose' }
				: { kind: 'provider', provider: single, request: PUBLISH }
		);
	}, [ home, loading, transferProvider, transferSiteId, hasPublished, single ] );

	const current: Screen | 'loading' | undefined =
		! screen || screen.kind === 'provider' || screen.kind === 'choose'
			? screen
			: screen.kind === 'home' || ( loading && ! hasPublished )
			? 'loading'
			: hasPublished
			? screen
			: fallback;
	return {
		providers,
		published,
		screen: current,
		provider: typeof current === 'object' && current.kind === 'provider' ? current.provider : null,
		canGoBack: hasPublished || ! single,
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
		add: () =>
			setScreen(
				single ? { kind: 'provider', provider: single, request: ADD } : { kind: 'choose' }
			),
		choose: ( provider: SitesProviderId ) =>
			setScreen( { kind: 'provider', provider, request: ADD } ),
		back: () => setScreen( { kind: hasPublished ? 'list' : 'choose' } ),
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
					const address = getSitesDescriptor( provider ).address( website );
					const { label } = getProviderDescriptor( provider );
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
			<Button variant="outline" className={ styles.add } onClick={ tab.add }>
				<PlusIcon aria-hidden="true" />
				{ __( 'Publish to another site…' ) }
			</Button>
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
					const { label } = getProviderDescriptor( provider );
					const { intro } = getSitesDescriptor( provider );
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
			{ tab.canGoBack && ! substep ? (
				<BackButton
					label={ tab.published.length ? __( 'Published sites' ) : __( 'Back' ) }
					onClick={ tab.back }
				/>
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
