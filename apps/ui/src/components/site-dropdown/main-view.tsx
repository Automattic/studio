import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { type SiteOperationKind } from '@studio/common/lib/site-operation';
import { __, sprintf } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import { XdebugIcon } from '@/components/xdebug-icon';
import { useConnector } from '@/data/core';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOperation,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { getSiteUrl } from '@/lib/get-site-url';
import styles from './main-view.module.css';
import { PopoverRow } from './popover-row';
import { getSyncActivityLabel } from './trigger-secondary';
import { deriveSiteStatus, getSiteStatusName } from './utils';
import type { SiteDetails } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

type Props = {
	site: SiteDetails;
	activity: SyncActivity | null;
};

export function MainView( { site, activity }: Props ) {
	const connector = useConnector();
	const openInDestinations = useOpenInDestinations( site );

	const startSite = useStartSite();
	const stopSite = useStopSite();

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const isOperationInProgress = useIsSiteBusy( site );
	const operation = useSiteOperation( site );
	const { localSublabel } = deriveSiteStatus( site, isStarting, isStopping, operation );
	const localSiteUrl = getSiteUrl( site );
	const canOpenLocalSite = site.running && ! isStopping;

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const handleStartLocalClick = () => {
		if ( isOperationInProgress || site.running ) return;
		startSite.mutate( site.id );
	};

	const handleStopLocalClick = () => {
		if ( isOperationInProgress || ! site.running ) return;
		stopSite.mutate( site.id );
	};

	const renderUrlLink = ( {
		text,
		url,
		label,
		onOpen,
	}: {
		text: string;
		url: string;
		label: string;
		onOpen?: () => void;
	} ) => (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						className={ styles.urlLink }
						aria-label={ label }
						onClick={ () => {
							onOpen?.();
							openExternal( url );
						} }
					>
						<span>{ text }</span>
						<Icon icon={ external } size={ 12 } aria-hidden="true" />
					</button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);

	return (
		<div className={ styles.rows }>
			{ activity?.direction === 'import' &&
			( activity.kind === 'pending' || activity.kind === 'error' ) ? (
				<SyncActivityDetails activity={ activity } />
			) : null }

			<PopoverRow
				label={
					site.enableXdebug ? (
						<>
							{ __( 'Studio' ) }
							<XdebugBadge running={ site.running } />
						</>
					) : (
						__( 'Studio' )
					)
				}
				sublabel={
					canOpenLocalSite
						? renderUrlLink( {
								text: localSublabel,
								url: localSiteUrl,
								label: __( 'Open Studio site in your browser' ),
								onOpen: () =>
									void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_IN_BROWSER, {
										browser: 'external',
									} ),
						  } )
						: localSublabel
				}
				action={
					<LocalServerControl
						running={ site.running }
						starting={ isStarting }
						stopping={ isStopping }
						operation={ operation }
						onStart={ handleStartLocalClick }
						onStop={ handleStopLocalClick }
					/>
				}
			/>

			<PopoverRow
				label={ __( 'Open in' ) }
				action={
					<div className={ styles.openIn }>
						{ openInDestinations.map( ( destination ) => (
							<IconButton
								key={ destination.id }
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ destination.logo }
								label={ destination.label }
								disabled={ destination.disabled }
								onClick={ destination.open }
							/>
						) ) }
					</div>
				}
			/>
		</div>
	);
}

function XdebugBadge( { running }: { running: boolean } ) {
	const label = __( 'Xdebug enabled' );

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<span
						className={ clsx( styles.xdebugBadge, ! running && styles.xdebugBadge_stopped ) }
						role="img"
						aria-label={ label }
					/>
				}
			>
				<XdebugIcon className={ styles.xdebugGlyph } />
			</Tooltip.Trigger>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);
}

function SyncActivityDetails( {
	activity,
}: {
	activity: Extract< SyncActivity, { kind: 'pending' | 'error' } >;
} ) {
	return (
		<div
			className={ clsx(
				styles.activityStatus,
				activity.kind === 'error' ? styles.activityStatusError : styles.activityStatusPending
			) }
		>
			<div className={ styles.activityStatusText } role="status" aria-live="polite">
				<div className={ styles.activityStatusTitle }>{ getSyncActivityLabel( activity ) }</div>
				<div className={ styles.activityStatusMessage }>
					{ activity.message ?? __( 'Preparing the backup…' ) }
				</div>
			</div>
		</div>
	);
}

// The toggle tracks where the site is heading, not where it is, so an in-flight
// start reads as running before the server is actually up.
function getTargetRunning( running: boolean, starting: boolean, stopping: boolean ): boolean {
	if ( starting ) {
		return true;
	}
	if ( stopping ) {
		return false;
	}
	return running;
}

function LocalServerControl( {
	running,
	starting,
	stopping,
	operation,
	onStart,
	onStop,
}: {
	running: boolean;
	starting: boolean;
	stopping: boolean;
	// A CLI operation (an agent settings change, another window's delete). Blocks
	// the toggle and names itself in the tooltip, so a dead control explains why.
	operation: SiteOperationKind | null;
	onStart: () => void;
	onStop: () => void;
} ) {
	// aria-disabled rather than disabled: a natively disabled button suppresses
	// the pointer events the tooltip listens for, hiding the status exactly
	// while the site is transitioning.
	const pending = starting || stopping || operation !== null;
	const targetRunning = getTargetRunning( running, starting, stopping );
	const statusLabel = sprintf(
		__( 'Site status: %s' ),
		getSiteStatusName( { running, starting, stopping, operation } )
	);
	const actionLabel = running ? __( 'Stop site' ) : __( 'Start site' );

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						className={ clsx(
							styles.localServerControl,
							targetRunning && styles.localServerControl_running,
							pending && styles.localServerControl_pending
						) }
						aria-label={
							pending ? statusLabel : sprintf( __( '%1$s. %2$s' ), statusLabel, actionLabel )
						}
						role="switch"
						aria-checked={ targetRunning }
						aria-busy={ pending || undefined }
						aria-disabled={ pending || undefined }
						onClick={ () => {
							if ( pending ) {
								return;
							}
							if ( targetRunning ) {
								onStop();
							} else {
								onStart();
							}
						} }
					>
						<span className={ styles.localServerThumb } aria-hidden="true">
							<span
								className={ clsx(
									styles.localServerGlyph,
									targetRunning ? styles.pauseIcon : styles.playIcon
								) }
							/>
						</span>
					</button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
				{ statusLabel }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}
