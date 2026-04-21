import { Popover } from '@base-ui/react/popover';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import {
	arrowDown,
	arrowUp,
	check,
	chevronDownSmall,
	chevronLeft,
	closeSmall,
	external,
	plus,
	seen,
} from '@wordpress/icons';
import { Button, Icon, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef, useMemo, useState } from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import {
	connectedWpcomSitesQueryKey,
	useConnectedWpcomSites,
} from '@/data/queries/use-connected-wpcom-sites';
import {
	usePublishPreviewSite,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-site-publish';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { usePickableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { getSiteDisplayUrl, getSiteUrl } from '@/lib/get-site-url';
import styles from './style.module.css';
import type { SiteDetails, Snapshot, SyncSite } from '@/data/core';
import type { ComponentProps, ElementRef } from 'react';

type SiteStatus = 'running' | 'stopped' | 'transitioning';

function stripProtocol( url: string ): string {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

type TriggerProps = Omit< ComponentProps< typeof Button >, 'children' > & {
	siteName: string;
	siteUrl: string;
	status: SiteStatus;
	statusLabel: string;
	environment: 'local' | 'live';
};

const DropdownTrigger = forwardRef< ElementRef< typeof Button >, TriggerProps >(
	function DropdownTrigger(
		{ siteName, siteUrl, status, statusLabel, environment, className, ...props },
		ref
	) {
		// In live mode the local server's running/stopped status is irrelevant
		// to what the agent targets; use a dedicated dot color so the trigger
		// visibly mirrors the environment pill.
		const dotClass =
			environment === 'live' ? styles.triggerDot_live : styles[ `triggerDot_${ status }` ];
		return (
			<Button
				ref={ ref }
				variant="minimal"
				tone="neutral"
				size="small"
				className={ clsx( styles.trigger, className ) }
				{ ...props }
			>
				<span className={ styles.triggerSite }>{ siteName }</span>
				<span className={ styles.triggerStatus }>
					<span
						className={ clsx( styles.triggerDot, dotClass ) }
						role="img"
						aria-label={ statusLabel }
					/>
					<span className={ styles.triggerEnv }>
						{ environment === 'live' ? __( 'Live' ) : __( 'Local' ) }
					</span>
				</span>
				<span className={ styles.triggerUrl }>{ siteUrl }</span>
				<Icon icon={ chevronDownSmall } />
			</Button>
		);
	}
);

function PopoverRow( {
	label,
	sublabel,
	action,
}: {
	label: React.ReactNode;
	sublabel?: React.ReactNode;
	action?: React.ReactNode;
} ) {
	return (
		<div className={ styles.row }>
			<div className={ styles.rowText }>
				<div className={ styles.rowLabel }>{ label }</div>
				{ sublabel ? <div className={ styles.rowSublabel }>{ sublabel }</div> : null }
			</div>
			{ action ? <div className={ styles.rowAction }>{ action }</div> : null }
		</div>
	);
}

type Props = {
	site: SiteDetails;
	// Optional: when rendered inside a session view, the dropdown reflects the
	// session's active environment (local vs. live) rather than always reading
	// "Local". Outside a session context these default to local.
	activeEnvironment?: 'local' | 'live';
};

function ensureProtocol( url: string ): string {
	return /^https?:\/\//.test( url ) ? url : `https://${ url }`;
}

function pickLiveSite( connectedSites: SyncSite[] | undefined ): SyncSite | undefined {
	if ( ! connectedSites || connectedSites.length === 0 ) {
		return undefined;
	}
	// Prefer the production (non-staging) site; fall back to anything connected
	// so a staging-only link is still surfaced rather than silently dropped.
	return connectedSites.find( ( site ) => ! site.isStaging ) ?? connectedSites[ 0 ];
}

function pickLatestSnapshot(
	snapshots: Snapshot[] | undefined,
	siteId: string
): Snapshot | undefined {
	if ( ! snapshots ) {
		return undefined;
	}
	// `date` is a unix timestamp; the most recent snapshot wins.
	return snapshots
		.filter( ( snapshot ) => snapshot.localSiteId === siteId )
		.reduce< Snapshot | undefined >( ( latest, candidate ) => {
			if ( ! latest || candidate.date > latest.date ) {
				return candidate;
			}
			return latest;
		}, undefined );
}

// `previewSnapshot.url` is stored as a bare hostname. The CLI `preview
// update` subcommand expects that same hostname as its positional arg —
// keep them aligned so a refresh targets the existing preview instead of
// creating a new one.
function getSnapshotHostname( snapshot: Snapshot ): string {
	return snapshot.url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

type SyncDirection = 'push' | 'pull' | 'preview';

function getPendingIcon( direction: SyncDirection ) {
	if ( direction === 'preview' ) {
		return seen;
	}
	return direction === 'push' ? arrowUp : arrowDown;
}

function getPendingLabel( direction: SyncDirection ): string {
	if ( direction === 'preview' ) {
		return __( 'Publishing preview…' );
	}
	return direction === 'push' ? __( 'Publishing to live…' ) : __( 'Pulling from live…' );
}

function getSuccessLabel( direction: SyncDirection ): string {
	if ( direction === 'preview' ) {
		return __( 'Preview published' );
	}
	return direction === 'push' ? __( 'Published to live' ) : __( 'Pulled from live' );
}

function getErrorLabel( direction: SyncDirection ): string {
	if ( direction === 'preview' ) {
		return __( 'Publishing preview failed' );
	}
	return direction === 'push'
		? __( 'Publishing to live failed' )
		: __( 'Pulling from live failed' );
}

function SyncActivityIndicator( { siteId }: { siteId: string } ) {
	const activity = useSiteSyncActivity( siteId );
	if ( ! activity ) {
		return null;
	}

	// All three states render an IconButton so we reuse its built-in tooltip
	// wiring (@wordpress/ui wraps each IconButton in its own Tooltip.Provider
	// with delay=0). `focusableWhenDisabled` keeps the tooltip trigger active
	// even when the button itself is visually disabled for pending/success.

	if ( activity.kind === 'pending' ) {
		return (
			<IconButton
				variant="minimal"
				tone="neutral"
				size="small"
				icon={ getPendingIcon( activity.direction ) }
				label={ getPendingLabel( activity.direction ) }
				disabled
				focusableWhenDisabled
				className={ clsx( styles.syncIndicator, styles.syncIndicator_pending ) }
			/>
		);
	}

	if ( activity.kind === 'success' ) {
		return (
			<IconButton
				variant="minimal"
				tone="neutral"
				size="small"
				icon={ check }
				label={ getSuccessLabel( activity.direction ) }
				disabled
				focusableWhenDisabled
				className={ clsx( styles.syncIndicator, styles.syncIndicator_success ) }
			/>
		);
	}

	// Error: active IconButton that opens a popover with the full message.
	// The built-in tooltip shows the short label on hover; clicking reveals
	// the details. Popover.Trigger receives the IconButton via its `render`
	// prop so both behaviours share the same DOM element.
	const label = getErrorLabel( activity.direction );
	return (
		<Popover.Root>
			<Popover.Trigger
				render={
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ closeSmall }
						label={ label }
						className={ clsx( styles.syncIndicator, styles.syncIndicator_error ) }
					/>
				}
			/>
			<Popover.Portal>
				<Popover.Positioner side="bottom" align="end" sideOffset={ 6 }>
					<Popover.Popup className={ styles.errorPopup }>
						<div className={ styles.errorPopupTitle }>{ label }</div>
						<div className={ styles.errorPopupMessage }>{ activity.message }</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

export function SiteDropdown( { site, activeEnvironment = 'local' }: Props ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { data: snapshots } = useSnapshots();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const [ view, setView ] = useState< 'main' | 'picker' >( 'main' );
	const pickerEnabled = view === 'picker';
	const pickableSites = usePickableWpcomSites( { enabled: pickerEnabled } );
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
	const isPublishing = pushSiteToLive.isPending || publishPreviewSite.isPending;
	// Pull/push are mutually exclusive against the same local site — the
	// pull command stops + restarts the server, so running it mid-push (or
	// vice-versa) would wedge both. Also block while a push is in flight.
	const isSyncing = isPublishing || pullSiteFromLive.isPending;
	const status: SiteStatus =
		isStarting || isStopping ? 'transitioning' : site.running ? 'running' : 'stopped';

	const statusLabel =
		status === 'running'
			? __( 'Site is running' )
			: status === 'transitioning'
			? isStopping
				? __( 'Site is stopping' )
				: __( 'Site is starting' )
			: __( 'Site is stopped' );

	const localSublabel =
		status === 'transitioning'
			? isStopping
				? __( 'Stopping…' )
				: __( 'Starting…' )
			: getSiteDisplayUrl( site );

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const toggleServer = () => {
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
		if ( publishPreviewSite.isPending ) {
			return;
		}
		publishPreviewSite.mutate(
			{
				siteId: site.id,
				existingHostname: previewSnapshot ? getSnapshotHostname( previewSnapshot ) : undefined,
			},
			{
				onSuccess: ( { url } ) => {
					openExternal( ensureProtocol( url ) );
				},
			}
		);
	};

	const handlePullClick = () => {
		if ( ! liveSite || isSyncing ) {
			return;
		}
		pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: liveSite.id } );
	};

	const handlePublishClick = () => {
		if ( isSyncing ) {
			return;
		}
		if ( liveSite ) {
			pushSiteToLive.mutate(
				{ siteId: site.id, remoteSiteId: liveSite.id },
				{
					onSuccess: () => {
						openExternal( ensureProtocol( liveSite.url ) );
					},
				}
			);
			return;
		}
		// No live site yet — let the user pick an existing WordPress.com site
		// to connect + push to, or link out to the checkout flow to create a
		// new one. Both options live in the picker view so the dropdown
		// doesn't grow unbounded in its default state.
		setView( 'picker' );
	};

	const handlePickWpcomSite = async ( pickedSite: SyncSite ) => {
		try {
			await connector.connectWpcomSite( site.id, {
				...pickedSite,
				localSiteId: site.id,
				syncSupport: 'already-connected',
			} );
			await queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( site.id ),
			} );
			setView( 'main' );
			pushSiteToLive.mutate(
				{ siteId: site.id, remoteSiteId: pickedSite.id },
				{
					onSuccess: () => {
						openExternal( ensureProtocol( pickedSite.url ) );
					},
				}
			);
		} catch ( error ) {
			console.error( 'Failed to connect WordPress.com site:', error );
		}
	};

	const handleCreateNewSite = () => {
		const checkoutUrl = connector.getPublishCheckoutUrl( site );
		if ( checkoutUrl ) {
			openExternal( checkoutUrl );
		}
		// The deep-link listener handles the follow-up connection once the
		// user finishes checkout, so we just close the picker here.
		setView( 'main' );
	};

	return (
		<div className={ styles.root }>
			<Menu.Root
				modal={ false }
				onOpenChange={ ( open ) => {
					// Reset to the main view whenever the dropdown closes so the
					// next opening doesn't unexpectedly land in the picker state.
					if ( ! open ) {
						setView( 'main' );
					}
				} }
			>
				<Menu.Trigger
					render={
						<DropdownTrigger
							siteName={ site.name }
							siteUrl={ getSiteDisplayUrl( site ) }
							status={ status }
							statusLabel={ statusLabel }
							environment={ activeEnvironment }
						/>
					}
				/>
				<Menu.Popup side="bottom" align="start" className={ styles.popup }>
					{ view === 'main' ? (
						<>
							<div className={ styles.rows }>
								<PopoverRow
									label={ __( 'Local site' ) }
									sublabel={ localSublabel }
									action={
										<div className={ styles.localActions }>
											<Button
												variant="minimal"
												tone="neutral"
												size="small"
												loading={ status === 'transitioning' }
												loadingAnnouncement={ isStopping ? __( 'Stopping' ) : __( 'Starting' ) }
												onClick={ toggleServer }
											>
												{ site.running ? __( 'Stop' ) : __( 'Start' ) }
											</Button>
											{ site.running ? (
												<IconButton
													variant="minimal"
													tone="neutral"
													size="small"
													icon={ external }
													label={ __( 'Open local site' ) }
													onClick={ () => openExternal( getSiteUrl( site ) ) }
												/>
											) : null }
										</div>
									}
								/>

								<PopoverRow
									label={ __( 'Live site' ) }
									sublabel={ liveSite ? stripProtocol( liveSite.url ) : __( 'Not yet published' ) }
									action={
										liveSite ? (
											<div className={ styles.localActions }>
												<IconButton
													variant="minimal"
													tone="neutral"
													size="small"
													icon={ arrowDown }
													label={ __( 'Pull from live' ) }
													loading={ pullSiteFromLive.isPending }
													loadingAnnouncement={ __( 'Pulling from live' ) }
													disabled={ isSyncing }
													onClick={ handlePullClick }
												/>
												<IconButton
													variant="minimal"
													tone="neutral"
													size="small"
													icon={ external }
													label={ __( 'Open live site' ) }
													onClick={ () => openExternal( ensureProtocol( liveSite.url ) ) }
												/>
											</div>
										) : null
									}
								/>

								{ previewSnapshot ? (
									<PopoverRow
										label={ __( 'Preview site' ) }
										sublabel={ stripProtocol( previewSnapshot.url ) }
										action={
											<IconButton
												variant="minimal"
												tone="neutral"
												size="small"
												icon={ external }
												label={ __( 'Open preview site' ) }
												onClick={ () => openExternal( ensureProtocol( previewSnapshot.url ) ) }
											/>
										}
									/>
								) : null }
							</div>

							<div className={ styles.footer }>
								<Button
									variant="outline"
									tone="neutral"
									size="compact"
									className={ styles.footerButton }
									loading={ publishPreviewSite.isPending }
									loadingAnnouncement={
										previewSnapshot ? __( 'Updating preview…' ) : __( 'Creating preview…' )
									}
									disabled={ isSyncing }
									onClick={ handlePreviewClick }
								>
									{ previewSnapshot ? __( 'Update preview' ) : __( 'Preview' ) }
								</Button>
								<Button
									variant="solid"
									tone="brand"
									size="compact"
									className={ styles.footerButton }
									loading={ pushSiteToLive.isPending }
									loadingAnnouncement={ __( 'Publishing…' ) }
									disabled={ isSyncing }
									onClick={ handlePublishClick }
								>
									{ liveSite ? __( 'Publish' ) : __( 'Publish…' ) }
								</Button>
							</div>
						</>
					) : (
						<PublishPickerView
							pickableSites={ pickableSites.data }
							isLoading={ pickableSites.isLoading }
							onBack={ () => setView( 'main' ) }
							onPickSite={ handlePickWpcomSite }
							onCreateNew={ handleCreateNewSite }
						/>
					) }
				</Menu.Popup>
			</Menu.Root>
			<SyncActivityIndicator siteId={ site.id } />
		</div>
	);
}

type PublishPickerViewProps = {
	pickableSites: SyncSite[] | undefined;
	isLoading: boolean;
	onBack: () => void;
	onPickSite: ( site: SyncSite ) => void;
	onCreateNew: () => void;
};

function PublishPickerView( {
	pickableSites,
	isLoading,
	onBack,
	onPickSite,
	onCreateNew,
}: PublishPickerViewProps ) {
	return (
		<div className={ styles.picker }>
			<div className={ styles.pickerHeader }>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ chevronLeft }
					label={ __( 'Back' ) }
					onClick={ onBack }
				/>
				<span className={ styles.pickerTitle }>{ __( 'Publish this site' ) }</span>
			</div>
			<div className={ styles.pickerBody }>
				{ isLoading ? (
					<div className={ styles.pickerStatus }>{ __( 'Loading sites…' ) }</div>
				) : pickableSites && pickableSites.length > 0 ? (
					<ul className={ styles.pickerList }>
						{ pickableSites.map( ( candidate ) => (
							<li key={ candidate.id }>
								<button
									type="button"
									className={ styles.pickerItem }
									onClick={ () => onPickSite( candidate ) }
								>
									<span className={ styles.pickerItemName }>
										{ candidate.name || candidate.url }
									</span>
									<span className={ styles.pickerItemUrl }>
										{ candidate.url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' ) }
									</span>
								</button>
							</li>
						) ) }
					</ul>
				) : (
					<div className={ styles.pickerStatus }>
						{ __( 'No WordPress.com sites available to publish to.' ) }
					</div>
				) }
			</div>
			<button type="button" className={ styles.pickerCreate } onClick={ onCreateNew }>
				<Icon icon={ plus } size={ 16 } />
				<span>{ __( 'Create a new WordPress.com site…' ) }</span>
			</button>
		</div>
	);
}
