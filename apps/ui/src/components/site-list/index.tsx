import { useNavigate, useParams } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { cog } from '@wordpress/icons';
import { IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo } from 'react';
import { SidebarButton } from '@/components/sidebar-button';
import { deriveSiteStatus } from '@/components/site-dropdown/utils';
import { SiteIcon } from '@/components/site-icon';
import { useSessions } from '@/data/queries/use-sessions';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

type SiteRow = {
	site: SiteDetails;
	latestSession?: AiSessionSummary;
	sessionIds: string[];
};

function getTimestamp( session: AiSessionSummary | undefined ): number {
	return session ? Date.parse( session.updatedAt ) || 0 : 0;
}

function createSiteRows(
	sites: SiteDetails[] | undefined,
	sessions: AiSessionSummary[] | undefined
): SiteRow[] {
	const rows: SiteRow[] = ( sites ?? [] ).map( ( site ) => ( {
		site,
		sessionIds: [],
		latestSession: undefined,
	} ) );
	const rowsByPath = new Map( rows.map( ( row ) => [ row.site.path, row ] ) );

	for ( const session of sessions ?? [] ) {
		if ( ! session.ownerSitePath ) {
			continue;
		}
		const row = rowsByPath.get( session.ownerSitePath );
		if ( ! row ) {
			continue;
		}
		row.sessionIds.push( session.id );
		if (
			! session.archived &&
			( ! row.latestSession || getTimestamp( session ) > getTimestamp( row.latestSession ) )
		) {
			row.latestSession = session;
		}
	}

	return [ ...rows ].sort( ( a, b ) => {
		const timestampDelta = getTimestamp( b.latestSession ) - getTimestamp( a.latestSession );
		return timestampDelta || 0;
	} );
}

function SiteOverviewButton( { site }: { site: SiteDetails } ) {
	const navigate = useNavigate();

	return (
		<IconButton
			variant="minimal"
			tone="neutral"
			size="small"
			icon={ cog }
			label={ __( 'Site overview' ) }
			className={ styles.siteAction }
			onClick={ () =>
				void navigate( {
					to: '/sites/$siteId/overview',
					params: { siteId: site.id },
				} )
			}
		/>
	);
}

function SiteStatusButton( {
	site,
	isStarting,
	isStopping,
}: {
	site: SiteDetails;
	isStarting: boolean;
	isStopping: boolean;
} ) {
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const { status } = deriveSiteStatus( site, isStarting, isStopping );
	const busy = isStarting || isStopping;
	const statusName =
		status === 'running'
			? __( 'Running' )
			: status === 'transitioning'
			? isStopping
				? __( 'Stopping' )
				: __( 'Starting' )
			: __( 'Stopped' );
	const tooltipLabel = sprintf( __( 'Site status: %s' ), statusName );
	const actionLabel = site.running ? __( 'Stop site' ) : __( 'Start site' );
	const label = busy ? tooltipLabel : sprintf( __( '%1$s. %2$s' ), tooltipLabel, actionLabel );
	const handleClick = () => {
		if ( busy ) {
			return;
		}
		if ( site.running ) {
			stopSite.mutate( site.id );
		} else {
			startSite.mutate( site.id );
		}
	};

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						className={ styles.siteStatus }
						aria-label={ label }
						aria-busy={ busy || undefined }
						aria-disabled={ busy || undefined }
						data-state={ status }
						onClick={ busy ? undefined : handleClick }
					>
						<svg
							className={ styles.siteStatusGlyph }
							viewBox={ status === 'stopped' ? '0 0 10 10' : '0 0 8 8' }
							aria-hidden="true"
							focusable="false"
						>
							{ status === 'stopped' ? (
								<path className={ styles.siteStatusPlayShape } d="M2.5 1 L9 5 L2.5 9 Z" />
							) : (
								<rect className={ styles.siteStatusShape } x="0" y="0" width="8" height="8" />
							) }
						</svg>
						{ ! busy ? (
							<svg
								className={ styles.siteStatusActionGlyph }
								viewBox="0 0 10 10"
								aria-hidden="true"
								focusable="false"
							>
								{ site.running ? (
									<rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
								) : (
									<path d="M2.5 1 L9 5 L2.5 9 Z" fill="currentColor" />
								) }
							</svg>
						) : null }
					</button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
				{ tooltipLabel }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}

function SiteSection( { row, isActive }: { row: SiteRow; isActive: boolean } ) {
	const { site, latestSession } = row;
	const navigate = useNavigate();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const isStopped = ! site.running && ! isStarting;
	const handleOpenSite = () => {
		if ( latestSession ) {
			void navigate( {
				to: '/sessions/$sessionId',
				params: { sessionId: latestSession.id },
			} );
			return;
		}
		void navigate( {
			to: '/sites/$siteId/new',
			params: { siteId: site.id },
		} );
	};

	return (
		<section className={ clsx( styles.site, isActive && styles.siteActive ) }>
			<header className={ styles.siteHeader }>
				<div className={ styles.siteText }>
					<SidebarButton
						className={ styles.siteToggle }
						onClick={ handleOpenSite }
						aria-current={ isActive ? 'page' : undefined }
					>
						<span className={ styles.siteIconSlot } aria-hidden="true">
							<SiteIcon
								className={ clsx( styles.siteIcon, isStopped && styles.siteIconStopped ) }
								seed={ `${ site.id }:${ site.name }:${ site.path }` }
								imageSrc={ site.siteIcon }
							/>
						</span>
						<span className={ styles.siteName }>{ site.name }</span>
					</SidebarButton>
				</div>
				<div className={ styles.siteActions }>
					<SiteOverviewButton site={ site } />
					<SiteStatusButton site={ site } isStarting={ isStarting } isStopping={ isStopping } />
				</div>
			</header>
		</section>
	);
}

function findActiveSiteKey(
	rows: SiteRow[],
	activeSessionId: string | undefined,
	activeSiteId: string | undefined
): string | undefined {
	if ( activeSiteId ) {
		const match = rows.find( ( row ) => row.site.id === activeSiteId );
		if ( match ) return match.site.id;
	}
	if ( ! activeSessionId ) {
		return undefined;
	}
	for ( const row of rows ) {
		if ( row.sessionIds.includes( activeSessionId ) ) {
			return row.site.id;
		}
	}
	return undefined;
}

export function SiteList() {
	const { data: sites, isLoading: sitesLoading } = useSites();
	const { data: sessions, isLoading: sessionsLoading } = useSessions();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const activeSessionId = params.sessionId;
	const activeSiteId = params.siteId;

	const rows = useMemo( () => createSiteRows( sites, sessions ), [ sites, sessions ] );
	const activeSiteKey = useMemo(
		() => findActiveSiteKey( rows, activeSessionId, activeSiteId ),
		[ rows, activeSessionId, activeSiteId ]
	);

	return (
		<div className={ styles.root }>
			{ sitesLoading || sessionsLoading ? (
				<p className={ styles.empty }>{ __( 'Loading…' ) }</p>
			) : rows.length === 0 ? (
				<p className={ styles.empty }>{ __( 'No sites yet' ) }</p>
			) : (
				<div className={ styles.sites }>
					{ rows.map( ( row ) => (
						<SiteSection
							key={ row.site.id }
							row={ row }
							isActive={ row.site.id === activeSiteKey }
						/>
					) ) }
				</div>
			) }
		</div>
	);
}
