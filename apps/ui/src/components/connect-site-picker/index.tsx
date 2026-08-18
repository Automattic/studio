import { Spinner, VisuallyHidden } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { external, search } from '@wordpress/icons';
import { Badge, Button, Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { useConnector } from '@/data/core';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useOffline } from '@/hooks/use-offline';
import { getLocalizedLink } from '@/lib/docs-links';
import { presentRemoteSites, searchRemoteSites, type ConnectSiteGroup } from './site-presentation';
import styles from './style.module.css';
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

function getEnvironmentIntent( site: SyncSite ) {
	if ( site.isPressable && site.environmentType === 'development' ) return 'informational';
	if ( site.isStaging || ( site.isPressable && site.environmentType === 'staging' ) )
		return 'medium';
	return 'stable';
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
	return __( 'This site does not support pulling into Studio.' );
}

export function getSiteName( site: SyncSite ): string {
	if ( site.name.trim() ) return site.name.trim();
	try {
		return new URL( site.url ).hostname;
	} catch {
		return __( 'WordPress site' );
	}
}

function RemoteSiteCard( {
	site,
	group,
	isSelected,
	onSelect,
}: ReturnType< typeof presentRemoteSites >[ number ] & {
	isSelected: boolean;
	onSelect: ( id: number ) => void;
} ) {
	const connector = useConnector();
	const isAvailable = group === 'available';
	const siteName = getSiteName( site );
	const providerLabel = site.isPressable ? __( 'Pressable' ) : __( 'WP.com' );
	const environmentLabel = getEnvironmentLabel( site );
	const siteStatus = isAvailable ? '' : getSiteStatus( site, group );
	const className = clsx(
		styles.siteCard,
		isSelected && styles.siteCardSelected,
		! isAvailable && styles.siteCardUnavailable
	);

	return (
		<li className={ styles.siteCardWrapper }>
			<button
				type="button"
				className={ className }
				aria-pressed={ isAvailable ? isSelected : undefined }
				disabled={ ! isAvailable }
				onClick={ () => isAvailable && onSelect( site.id ) }
			>
				<span className={ styles.siteThumb }>
					<img
						src={ `https://s0.wp.com/mshots/v1/${ encodeURIComponent( site.url ) }?w=600&h=400` }
						alt=""
						loading="lazy"
					/>
					<span className={ styles.badges }>
						<Badge intent="draft">{ providerLabel }</Badge>
						<Badge intent={ getEnvironmentIntent( site ) }>{ environmentLabel }</Badge>
					</span>
				</span>
				<span className={ styles.siteText }>
					<span className={ styles.siteName }>{ siteName }</span>
					<span className={ styles.siteUrl }>{ site.url.replace( /^https?:\/\//, '' ) }</span>
					{ siteStatus && <span className={ styles.siteStatus }>{ siteStatus }</span> }
				</span>
			</button>
			{ group === 'needs-transfer' && (
				<Button
					type="button"
					variant="minimal"
					tone="brand"
					className={ styles.siteAction }
					onClick={ () =>
						void connector.openExternalUrl( `https://wordpress.com/hosting-features/${ site.id }` )
					}
				>
					<span>{ __( 'Enable hosting features' ) }</span>
					<Icon icon={ external } size={ 14 } />
				</Button>
			) }
			{ group === 'needs-upgrade' && (
				<Button
					type="button"
					variant="minimal"
					tone="brand"
					className={ styles.siteAction }
					onClick={ () =>
						void connector.openExternalUrl( `https://wordpress.com/plans/${ site.id }` )
					}
				>
					<span>{ __( 'View plans' ) }</span>
					<Icon icon={ external } size={ 14 } />
				</Button>
			) }
		</li>
	);
}

export type ConnectSitePickerProps = {
	sites: SyncSite[] | undefined;
	isLoading: boolean;
	isFetching: boolean;
	error: unknown;
	onRefresh: () => void;
	selectedId: number | null;
	onSelect: ( id: number ) => void;
	// Shown when the account has no sites this flow can use.
	emptyTitle?: string;
	emptyDescription?: string;
};

/**
 * The list of WordPress.com and Pressable sites a Studio site can be wired to,
 * with its search, its grouping into what can and can't be connected, and the
 * states around loading them. Shared by onboarding, which uses it to bring a
 * live site down into Studio, and by publishing, which uses it to send one up —
 * the choice is the same either way, so it should look the same.
 */
export function ConnectSitePicker( {
	sites,
	isLoading,
	isFetching,
	error,
	onRefresh,
	selectedId,
	onSelect,
	emptyTitle = __( 'No sites found' ),
	emptyDescription = __( 'This account has no WordPress.com or Pressable sites to show.' ),
}: ConnectSitePickerProps ) {
	const connector = useConnector();
	const locale = useUserLocale();
	const isOffline = useOffline();
	const [ searchQuery, setSearchQuery ] = useState( '' );

	const presentedSites = useMemo( () => presentRemoteSites( sites ?? [] ), [ sites ] );
	const filteredSites = useMemo(
		() => searchRemoteSites( presentedSites, searchQuery ),
		[ presentedSites, searchQuery ]
	);
	const isSingleSite = presentedSites.length === 1 && searchQuery.trim() === '';
	const isSingleAvailableSite = isSingleSite && presentedSites[ 0 ].group === 'available';

	if ( isOffline ) {
		return (
			<div className={ styles.state } role="status">
				<h2>{ __( "You're offline" ) }</h2>
				<p>{ __( 'Reconnect to load your WordPress.com and Pressable sites.' ) }</p>
			</div>
		);
	}

	if ( isLoading ) {
		return (
			<div className={ styles.state } role="status">
				<Spinner />
				<p>{ __( 'Loading your sites…' ) }</p>
			</div>
		);
	}

	if ( error ) {
		return (
			<div className={ styles.state }>
				<h2>{ __( "We couldn't load your sites" ) }</h2>
				<p>{ __( 'Check your connection and try again.' ) }</p>
				<Button
					type="button"
					variant="outline"
					tone="neutral"
					loading={ isFetching }
					onClick={ onRefresh }
				>
					{ __( 'Retry' ) }
				</Button>
			</div>
		);
	}

	if ( presentedSites.length === 0 ) {
		return (
			<div className={ styles.state }>
				<h2>{ emptyTitle }</h2>
				<p>{ emptyDescription }</p>
				<Button
					type="button"
					variant="minimal"
					tone="brand"
					onClick={ () => void connector.openExternalUrl( createWpcomSiteUrl.toString() ) }
				>
					<span>{ __( 'Create a WordPress.com site' ) }</span>
					<Icon icon={ external } size={ 14 } />
				</Button>
			</div>
		);
	}

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
			description: __( 'These sites cannot currently be connected to Studio.' ),
			sites: filteredSites.filter( ( entry ) => entry.group !== 'available' ),
		},
	];

	return (
		<>
			<div className={ styles.siteControls }>
				{ ! isSingleSite && (
					<label className={ styles.search }>
						<Icon icon={ search } size={ 18 } />
						<VisuallyHidden as="span">{ __( 'Search sites' ) }</VisuallyHidden>
						<input
							type="search"
							placeholder={ __( 'Search sites' ) }
							value={ searchQuery }
							onChange={ ( event ) => setSearchQuery( event.target.value ) }
						/>
					</label>
				) }
				<p className={ styles.helperLinks }>
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						size="small"
						disabled={ isFetching }
						onClick={ onRefresh }
					>
						{ isFetching ? __( 'Refreshing…' ) : __( 'Refresh list' ) }
					</Button>
					<span aria-hidden="true">·</span>
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						size="small"
						onClick={ () =>
							void connector.openExternalUrl( getLocalizedLink( locale, 'docsSyncSupportedSites' ) )
						}
					>
						<span>{ __( 'Supported sites' ) }</span>
						<Icon icon={ external } size={ 14 } />
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
			) : isSingleAvailableSite ? (
				<ul className={ `${ styles.siteGrid } ${ styles.singleSiteGrid }` }>
					<RemoteSiteCard
						{ ...filteredSites[ 0 ] }
						isSelected={ selectedId === filteredSites[ 0 ].site.id }
						onSelect={ onSelect }
					/>
				</ul>
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
									<ul className={ styles.siteGrid }>
										{ section.sites.map( ( entry ) => (
											<RemoteSiteCard
												key={ entry.site.id }
												{ ...entry }
												isSelected={ selectedId === entry.site.id }
												onSelect={ onSelect }
											/>
										) ) }
									</ul>
								</section>
							)
					) }
				</div>
			) }
		</>
	);
}
