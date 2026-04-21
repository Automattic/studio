import { __ } from '@wordpress/i18n';
import { chevronDownSmall, external } from '@wordpress/icons';
import { Button, Icon, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { forwardRef, useMemo } from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
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

export function SiteDropdown( { site, activeEnvironment = 'local' }: Props ) {
	const connector = useConnector();
	const { data: snapshots } = useSnapshots();
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const previewSnapshot = useMemo(
		() => pickLatestSnapshot( snapshots, site.id ),
		[ snapshots, site.id ]
	);
	const liveSite = useMemo( () => pickLiveSite( connectedSites ), [ connectedSites ] );

	const startSite = useStartSite();
	const stopSite = useStopSite();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
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

	return (
		<Menu.Root modal={ false }>
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
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ external }
									label={ __( 'Open live site' ) }
									onClick={ () => openExternal( ensureProtocol( liveSite.url ) ) }
								/>
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
					<Button variant="outline" tone="neutral" size="compact" className={ styles.footerButton }>
						{ __( 'Preview' ) }
					</Button>
					<Button variant="solid" tone="brand" size="compact" className={ styles.footerButton }>
						{ __( 'Publish…' ) }
					</Button>
				</div>
			</Menu.Popup>
		</Menu.Root>
	);
}
