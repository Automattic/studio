import { getLocalizedLink } from '@studio/common/lib/docs-links';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { __, _x, sprintf } from '@wordpress/i18n';
import { SearchIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useSyncableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { AccountPrompt } from '@/features/account';
import { useOffline } from '@/lib/hooks';
import { ExternalLinkIcon } from '@/lib/icons';
import {
	Alert,
	AlertActions,
	AlertDescription,
	AlertTitle,
	Badge,
	Empty,
	Button,
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	PreviewFrame,
	PreviewImage,
	Spinner,
} from '@/lib/ui';
import styles from './connect-panel.module.css';
import {
	getRemoteSiteName,
	presentRemoteSites,
	searchRemoteSites,
	type ConnectSiteGroup,
} from './site-presentation';
import type { SyncSite } from '@/data/core';

const createWpcomSiteUrl = new URL( 'https://wordpress.com/setup/new-hosted-site' );
createWpcomSiteUrl.searchParams.set( 'ref', 'studio' );
createWpcomSiteUrl.searchParams.set( 'section', 'studio-sync' );
createWpcomSiteUrl.searchParams.set( 'showDomainStep', 'true' );

function getEnvironmentLabel( site: SyncSite ): string {
	if ( site.isPressable && site.environmentType === 'development' ) return __( 'Development' );
	if ( site.isPressable && site.environmentType === 'staging' ) return __( 'Staging' );
	if ( site.isStaging ) return __( 'Staging' );
	return __( 'Production' );
}

function getEnvironmentVariant( site: SyncSite ) {
	return site.isStaging ||
		( site.isPressable &&
			( site.environmentType === 'development' || site.environmentType === 'staging' ) )
		? 'accent'
		: 'secondary';
}

function getSiteStatus( site: SyncSite, group: ConnectSiteGroup ): string {
	if ( group === 'needs-transfer' ) {
		return __( 'Enable hosting features on WordPress.com before connecting this site.' );
	}
	if ( group === 'needs-upgrade' ) {
		return __( 'Upgrade this site to a supported plan before connecting it.' );
	}
	if ( site.syncSupport === 'missing-permissions' ) {
		return __( "Your account doesn't have permission to manage this site." );
	}
	if ( site.syncSupport === 'deleted' ) return __( 'This site has been deleted.' );
	return __( 'This site does not support pulling into WordPress Studio.' );
}

function RemoteSiteCard( {
	site,
	group,
	onSelect,
}: ReturnType< typeof presentRemoteSites >[ number ] & {
	onSelect: ( site: SyncSite ) => void;
} ) {
	const connector = useConnector();
	const isAvailable = group === 'available';
	const siteName = getRemoteSiteName( site );
	const providerLabel = site.isPressable
		? _x( 'Pressable', 'hosting provider name' )
		: _x( 'WP.com', 'hosting provider name' );
	const environmentLabel = getEnvironmentLabel( site );
	const siteStatus = isAvailable ? '' : getSiteStatus( site, group );

	return (
		<li className={ styles.site }>
			<Button
				variant="outline"
				layout="row"
				className={ styles.siteRow }
				disabled={ ! isAvailable }
				onClick={ () => onSelect( site ) }
			>
				<PreviewFrame className={ styles.siteThumb }>
					<PreviewImage
						src={ `https://s0.wp.com/mshots/v1/${ encodeURIComponent( site.url ) }?w=600&h=400` }
						alt=""
					/>
				</PreviewFrame>
				<span className={ styles.siteText }>
					<span className={ styles.siteName }>{ siteName }</span>
					<span className={ styles.siteUrl }>{ site.url.replace( /^https?:\/\//, '' ) }</span>
				</span>
				<span className={ styles.badges }>
					<Badge variant="muted">{ providerLabel }</Badge>
					<Badge variant={ getEnvironmentVariant( site ) }>{ environmentLabel }</Badge>
				</span>
			</Button>
			{ siteStatus && <p className={ styles.siteStatus }>{ siteStatus }</p> }
			{ group === 'needs-transfer' && (
				<Button
					type="button"
					variant="inline-accent"
					size="sm"
					className={ styles.siteAction }
					onClick={ () =>
						void connector.openExternalUrl( `https://wordpress.com/hosting-features/${ site.id }` )
					}
				>
					{ __( 'Enable hosting features' ) }
					<ExternalLinkIcon data-icon="inline-end" />
				</Button>
			) }
			{ group === 'needs-upgrade' && (
				<Button
					type="button"
					variant="inline-accent"
					size="sm"
					className={ styles.siteAction }
					onClick={ () =>
						void connector.openExternalUrl( `https://wordpress.com/plans/${ site.id }` )
					}
				>
					{ __( 'View plans' ) }
					<ExternalLinkIcon data-icon="inline-end" />
				</Button>
			) }
		</li>
	);
}

export function ConnectPanel( { onConnect }: { onConnect: ( site: SyncSite ) => void } ) {
	const connector = useConnector();
	const { data: user, isLoading: isAuthLoading } = useAuthUser();
	const locale = useUserLocale();
	const isOffline = useOffline();
	const remoteSites = useSyncableWpcomSites( {
		enabled: !! user && ! isOffline,
	} );
	const [ searchQuery, setSearchQuery ] = useState( '' );

	const presentedSites = useMemo(
		() => presentRemoteSites( remoteSites.data ?? [] ),
		[ remoteSites.data ]
	);
	const filteredSites = useMemo(
		() => searchRemoteSites( presentedSites, searchQuery ),
		[ presentedSites, searchQuery ]
	);
	const isSingleSite = presentedSites.length === 1 && searchQuery.trim() === '';
	const isLoadingSites = remoteSites.isLoading;
	const loadError = remoteSites.error;
	const sections = [
		{
			key: 'available',
			title: __( 'Available to connect' ),
			description: __( 'Select a site to create its local copy.' ),
			sites: filteredSites.filter( ( entry ) => entry.group === 'available' ),
		},
		{
			key: 'unavailable',
			title: __( 'Unavailable' ),
			description: __( 'These sites cannot currently be connected to WordPress Studio.' ),
			sites: filteredSites.filter( ( entry ) => entry.group !== 'available' ),
		},
	];

	const retry = useCallback( () => {
		void remoteSites.refetch();
	}, [ remoteSites ] );

	if ( ! isAuthLoading && ! user ) {
		return (
			<Empty>
				<AccountPrompt
					flush
					title={ __( 'Connect your WordPress' ) }
					description={ __(
						'Create an account or log in to connect your WordPress.com or Pressable sites and work on them locally.'
					) }
					source="add_site"
				/>
			</Empty>
		);
	}

	return (
		<div className={ styles.page }>
			<p className={ styles.intro }>
				{ __( 'Select a WordPress.com or Pressable site to bring into your WordPress Studio.' ) }
			</p>

			{ isAuthLoading && (
				<div className={ styles.state } role="status">
					<Spinner aria-hidden />
					<p>{ __( 'Checking your account…' ) }</p>
				</div>
			) }

			{ user && isOffline && (
				<div className={ styles.state } role="status">
					<h2>{ __( "You're offline" ) }</h2>
					<p>{ __( 'Reconnect to load your WordPress.com and Pressable sites.' ) }</p>
				</div>
			) }

			{ user && ! isOffline && isLoadingSites && (
				<div className={ styles.state } role="status">
					<Spinner aria-hidden />
					<p>{ __( 'Loading your sites…' ) }</p>
				</div>
			) }

			{ user && ! isOffline && ! isLoadingSites && loadError && (
				<Alert variant="destructive">
					<AlertTitle>{ __( "We couldn't load your sites" ) }</AlertTitle>
					<AlertDescription>{ __( 'Check your connection and try again.' ) }</AlertDescription>
					<AlertActions>
						<Button variant="outline" loading={ remoteSites.isFetching } onClick={ retry }>
							{ __( 'Retry' ) }
						</Button>
					</AlertActions>
				</Alert>
			) }

			{ user && ! isOffline && ! isLoadingSites && ! loadError && presentedSites.length === 0 && (
				<div className={ styles.state }>
					<h2>{ __( 'No sites found' ) }</h2>
					<p>{ __( 'This account has no WordPress.com or Pressable sites to show.' ) }</p>
					<Button
						type="button"
						variant="inline-accent"
						size="sm"
						onClick={ () => {
							// `section=studio-sync`, no `autoOpenPush` — a create, not a publish.
							void connector.trackEvent( TRACKS_EVENTS.SYNC_CREATE_SITE );
							void connector.openExternalUrl( createWpcomSiteUrl.toString() );
						} }
					>
						{ __( 'Create a WordPress.com site' ) }
						<ExternalLinkIcon data-icon="inline-end" />
					</Button>
				</div>
			) }

			{ user && ! isOffline && ! isLoadingSites && ! loadError && presentedSites.length > 0 && (
				<>
					<div className={ styles.siteControls }>
						{ ! isSingleSite && (
							<InputGroup className={ styles.search }>
								<InputGroupAddon>
									<SearchIcon />
								</InputGroupAddon>
								<InputGroupInput
									type="search"
									aria-label={ __( 'Search sites' ) }
									placeholder={ __( 'Search sites' ) }
									value={ searchQuery }
									onChange={ ( event ) => setSearchQuery( event.target.value ) }
								/>
							</InputGroup>
						) }
						<p className={ styles.helperLinks }>
							<Button
								type="button"
								variant="ghost"
								size="2xs"
								disabled={ remoteSites.isFetching }
								onClick={ retry }
							>
								{ remoteSites.isFetching ? __( 'Refreshing…' ) : __( 'Refresh list' ) }
							</Button>
							<span aria-hidden="true">·</span>
							<Button
								type="button"
								variant="ghost"
								size="2xs"
								onClick={ () =>
									void connector.openExternalUrl(
										getLocalizedLink( locale, 'docsSyncSupportedSites' )
									)
								}
							>
								{ __( 'Supported sites' ) }
								<ExternalLinkIcon data-icon="inline-end" />
							</Button>
						</p>
					</div>

					{ filteredSites.length === 0 ? (
						<div className={ styles.state } role="status">
							<p>
								{ sprintf(
									// translators: %s is the site search query.
									__( 'No sites match “%s”.' ),
									searchQuery
								) }
							</p>
						</div>
					) : (
						<div className={ styles.sections }>
							{ sections.map(
								( section ) =>
									section.sites.length > 0 && (
										<section key={ section.key } className={ styles.section }>
											<div className={ styles.sectionHeader }>
												<h2>{ section.title }</h2>
												<p>{ section.description }</p>
											</div>
											<ul className={ styles.siteList }>
												{ section.sites.map( ( entry ) => (
													<RemoteSiteCard
														key={ entry.site.id }
														{ ...entry }
														onSelect={ onConnect }
													/>
												) ) }
											</ul>
										</section>
									)
							) }
						</div>
					) }
				</>
			) }
		</div>
	);
}
