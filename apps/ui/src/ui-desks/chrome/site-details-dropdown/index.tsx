import { useIsMutating } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { download, external, formatListBullets, upload } from '@wordpress/icons';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import {
	deriveSiteStatus,
	ensureProtocol,
	getSnapshotHostname,
	pickLatestSnapshot,
	pickLiveSite,
} from '@/components/site-dropdown/utils';
import { SiteIcon } from '@/components/site-icon';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { getSiteDisplayUrl, getSiteUrl } from '@/lib/get-site-url';
import { Button, Menu } from '@/ui-desks/components';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

interface SiteDetailsDropdownProps {
	site: SiteDetails;
	disabled?: boolean;
}

function useIsSiteSyncing( siteId: string ): { push: boolean; pull: boolean } {
	const push =
		useIsMutating( {
			mutationKey: PUSH_TO_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0;
	const pull =
		useIsMutating( {
			mutationKey: PULL_FROM_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0;
	return { push, pull };
}

export function SiteDetailsDropdown( { site, disabled = false }: SiteDetailsDropdownProps ) {
	const connector = useConnector();
	const [ open, setOpen ] = useState( false );
	const { data: snapshots } = useSnapshots();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const previewSnapshot = useMemo(
		() => pickLatestSnapshot( snapshots, site.id ),
		[ snapshots, site.id ]
	);
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const publishPreviewSite = usePublishPreviewSite();
	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	const { status } = deriveSiteStatus( site, isStarting, isStopping );
	const checkoutUrl = connector.getPublishCheckoutUrl( site );
	const isPreviewPending = publishPreviewSite.isPending;
	const isSyncing = isPreviewPending || isPushPending || isPullPending;
	const previewActionLabel = isPreviewPending
		? __( 'Pushing to Preview' )
		: __( 'Push to Preview' );
	const pushActionLabel = isPushPending ? __( 'Pushing to Live' ) : __( 'Push to Live' );
	const pullActionLabel = isPullPending ? __( 'Pulling from Live' ) : __( 'Pull from Live' );

	const openExternal = ( url: string ) => {
		setOpen( false );
		void connector.openExternalUrl( url );
	};

	const handleToggleServer = () => {
		if ( status === 'transitioning' ) {
			return;
		}
		if ( site.running ) {
			stopSite.mutate( site.id );
		} else {
			startSite.mutate( site.id );
		}
	};

	const handlePreviewClick = () => {
		if ( isSyncing ) {
			return;
		}
		publishPreviewSite.mutate( {
			siteId: site.id,
			existingHostname: previewSnapshot ? getSnapshotHostname( previewSnapshot ) : undefined,
		} );
	};

	const handlePushClick = () => {
		if ( ! liveSite || isSyncing ) {
			return;
		}
		pushSiteToLive.mutate( { siteId: site.id, remoteSiteId: liveSite.id } );
	};

	const handlePullClick = () => {
		if ( ! liveSite || isSyncing ) {
			return;
		}
		pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: liveSite.id } );
	};

	return (
		<Menu.Root modal={ false } open={ open } onOpenChange={ setOpen }>
			<Menu.Trigger
				render={
					<Button
						className={ styles.detailsTrigger }
						disabled={ disabled }
						icon={ formatListBullets }
						label={ sprintf(
							/* translators: %s: current site name. */
							__( 'Site details for %s' ),
							site.name
						) }
						data-status={ status }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="start" sideOffset={ 8 } className={ styles.popup }>
				<header className={ styles.header }>
					<div className={ styles.headerIdentity }>
						<SiteBadge site={ site } size="panel" />
						<div className={ styles.headerText }>
							<div className={ styles.headerTitle } title={ site.name }>
								{ site.name }
							</div>
							<StatusLine tone={ status }>{ getHeaderStatusText( status, site ) }</StatusLine>
						</div>
					</div>
					<Button
						className={ styles.serverButton }
						variant="filled"
						size="small"
						label={ site.running ? __( 'Stop site' ) : __( 'Start site' ) }
						disabled={ status === 'transitioning' }
						aria-busy={ status === 'transitioning' ? 'true' : undefined }
						onClick={ handleToggleServer }
					>
						<span
							className={ site.running ? styles.stopGlyph : styles.startGlyph }
							aria-hidden="true"
						/>
						{ getServerButtonLabel( site.running, isStarting, isStopping ) }
					</Button>
				</header>

				<div className={ styles.divider } />

				<div className={ styles.rows }>
					<DetailsRow
						label={ __( 'Local' ) }
						status={ status }
						statusText={ getLocalStatusText( status, site ) }
						actions={
							<OpenButton
								label={ __( 'Open local site' ) }
								disabled={ ! site.running }
								onClick={ () => openExternal( getSiteUrl( site ) ) }
							/>
						}
					/>
					<DetailsRow
						label={ __( 'Preview' ) }
						status={ previewSnapshot ? 'running' : 'stopped' }
						statusText={
							previewSnapshot
								? sprintf(
										/* translators: %s: relative time since the preview site was last synced. */
										__( 'Synced %s' ),
										formatRelativeTimestamp( previewSnapshot.date )
								  )
								: __( 'Not yet created' )
						}
						actions={
							<>
								<Button
									className={ styles.syncButton }
									variant="quiet"
									size="small"
									icon={ upload }
									label={ previewActionLabel }
									disabled={ isSyncing }
									aria-busy={ isPreviewPending ? 'true' : undefined }
									onClick={ handlePreviewClick }
								>
									{ isPreviewPending ? __( 'Pushing...' ) : __( 'Push to Preview' ) }
								</Button>
								<OpenButton
									label={ __( 'Open preview site' ) }
									disabled={ ! previewSnapshot }
									onClick={ () => {
										if ( previewSnapshot ) {
											openExternal( ensureProtocol( previewSnapshot.url ) );
										}
									} }
								/>
							</>
						}
					/>
					<DetailsRow
						label={ __( 'Live' ) }
						status={ liveSite ? 'running' : 'stopped' }
						statusText={
							liveSite ? (
								<>
									<span>{ __( 'Connected' ) }</span>
									<span className={ styles.statusSeparator } aria-hidden="true" />
									<span>{ __( 'WordPress.com' ) }</span>
								</>
							) : (
								__( 'Not connected' )
							)
						}
						actions={
							liveSite ? (
								<>
									<Button
										className={ styles.syncButton }
										variant="quiet"
										size="small"
										icon={ upload }
										label={ pushActionLabel }
										disabled={ isSyncing }
										aria-busy={ isPushPending ? 'true' : undefined }
										onClick={ handlePushClick }
									>
										{ isPushPending ? __( 'Pushing...' ) : __( 'Push to Live' ) }
									</Button>
									<Button
										className={ styles.syncButton }
										variant="quiet"
										size="small"
										icon={ download }
										label={ pullActionLabel }
										disabled={ isSyncing }
										aria-busy={ isPullPending ? 'true' : undefined }
										onClick={ handlePullClick }
									>
										{ isPullPending ? __( 'Pulling...' ) : __( 'Pull' ) }
									</Button>
									<OpenButton
										label={ __( 'Open live site' ) }
										disabled={ isSyncing }
										onClick={ () => openExternal( ensureProtocol( liveSite.url ) ) }
									/>
								</>
							) : (
								<Button
									className={ styles.syncButton }
									variant="filled"
									size="small"
									label={ __( 'Connect live site' ) }
									disabled={ ! checkoutUrl }
									onClick={ () => {
										if ( checkoutUrl ) {
											openExternal( checkoutUrl );
										}
									} }
								>
									{ __( 'Connect' ) }
								</Button>
							)
						}
					/>
				</div>
			</Menu.Popup>
		</Menu.Root>
	);
}

function DetailsRow( {
	label,
	status,
	statusText,
	actions,
}: {
	label: string;
	status: SiteStatusTone;
	statusText: ReactNode;
	actions: ReactNode;
} ) {
	return (
		<div className={ styles.row }>
			<div className={ styles.rowText }>
				<div className={ styles.rowLabel }>{ label }</div>
				<StatusLine tone={ status }>{ statusText }</StatusLine>
			</div>
			<div className={ styles.rowActions }>{ actions }</div>
		</div>
	);
}

function OpenButton( {
	label,
	disabled,
	onClick,
}: {
	label: string;
	disabled?: boolean;
	onClick: () => void;
} ) {
	return (
		<Button
			className={ styles.openButton }
			variant="filled"
			size="small"
			icon={ external }
			label={ label }
			disabled={ disabled }
			onClick={ onClick }
		>
			{ __( 'Open' ) }
		</Button>
	);
}

type SiteStatusTone = 'running' | 'transitioning' | 'stopped';

function StatusLine( { tone, children }: { tone: SiteStatusTone; children: ReactNode } ) {
	return (
		<div className={ styles.statusLine }>
			<span
				className={ clsx( styles.statusDot, styles[ `statusDot_${ tone }` ] ) }
				aria-hidden="true"
			/>
			<span className={ styles.statusText }>{ children }</span>
		</div>
	);
}

function SiteBadge( {
	site,
	size,
	status,
}: {
	site: SiteDetails;
	size: 'panel';
	status?: SiteStatusTone;
} ) {
	const hasSiteIcon = Boolean( site.siteIcon );
	const content = hasSiteIcon ? (
		<SiteIcon
			className={ styles.siteBadgeImage }
			seed={ getSiteIconSeed( site ) }
			imageSrc={ site.siteIcon }
		/>
	) : (
		<span className={ styles.siteInitials }>{ getSiteInitials( site.name ) }</span>
	);

	return (
		<span
			className={ clsx( styles.siteBadge, styles[ `siteBadge_${ size }` ] ) }
			aria-hidden="true"
		>
			{ content }
			{ status ? (
				<span className={ clsx( styles.badgeStatus, styles[ `badgeStatus_${ status }` ] ) } />
			) : null }
		</span>
	);
}

function getSiteIconSeed( site: SiteDetails ) {
	return `${ site.id }:${ site.name }:${ site.path }`;
}

function getSiteInitials( name: string ) {
	const words = name.trim().split( /\s+/ ).filter( Boolean );
	const initials =
		words.length >= 2
			? `${ words[ 0 ].charAt( 0 ) }${ words[ 1 ].charAt( 0 ) }`
			: words[ 0 ]?.slice( 0, 2 );
	return ( initials || 'S' ).toUpperCase();
}

function getHeaderStatusText( status: SiteStatusTone, site: SiteDetails ) {
	if ( status === 'transitioning' ) {
		return site.running ? __( 'Stopping site' ) : __( 'Starting site' );
	}
	return site.running ? __( 'Running on localhost' ) : __( 'Stopped' );
}

function getLocalStatusText( status: SiteStatusTone, site: SiteDetails ) {
	if ( status === 'transitioning' ) {
		return site.running ? __( 'Stopping...' ) : __( 'Starting...' );
	}
	if ( site.running ) {
		return site.customDomain
			? sprintf(
					/* translators: %s: the local custom domain for the site. */
					__( 'Running at %s' ),
					getSiteDisplayUrl( site )
			  )
			: __( 'Running on localhost' );
	}
	return __( 'Stopped' );
}

function getServerButtonLabel( isRunning: boolean, isStarting: boolean, isStopping: boolean ) {
	if ( isStarting ) {
		return __( 'Starting...' );
	}
	if ( isStopping ) {
		return __( 'Stopping...' );
	}
	return isRunning ? __( 'Stop' ) : __( 'Start' );
}

function formatRelativeTimestamp( timestamp: number ) {
	return formatRelativeTime( new Date( timestamp ).toISOString() );
}
