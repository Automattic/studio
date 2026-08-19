import { __, sprintf } from '@wordpress/i18n';
import { Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { deriveSiteStatus, getSiteStatusName } from '@/components/site-toolbar/utils';
import { XdebugIcon } from '@/components/xdebug-icon';
import {
	useIsSiteBusy,
	useSiteOperation,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { MouseEvent } from 'react';

export type SiteRunStatus = 'running' | 'stopped' | 'transitioning';

interface SiteStatusButtonProps {
	site: SiteDetails;
	isStarting: boolean;
	isStopping: boolean;
	className?: string;
}

/**
 * The site's running state and its start/stop control in one 24px target: a
 * dot while idle, crossfading to the action it triggers on hover. When Xdebug
 * is on, its bug replaces the dot entirely — a persistent per-site setting
 * worth spotting at a glance — while keeping the same state colors.
 *
 * Shared by the sidebar rows and the site toolbar so the two never drift.
 */
export function SiteStatusButton( {
	site,
	isStarting,
	isStopping,
	className,
}: SiteStatusButtonProps ) {
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const operation = useSiteOperation( site );
	const busy = useIsSiteBusy( site );
	const { status } = deriveSiteStatus( site, isStarting, isStopping, operation );
	const isStopped = status === 'stopped';
	const statusName = getSiteStatusName( {
		running: site.running,
		starting: isStarting,
		stopping: isStopping,
		operation,
	} );
	const xdebug = Boolean( site.enableXdebug );
	const tooltipLabel = xdebug
		? sprintf( __( 'Site status: %s. Xdebug enabled' ), statusName )
		: sprintf( __( 'Site status: %s' ), statusName );
	const actionLabel = site.running ? __( 'Stop site' ) : __( 'Start site' );
	const label = busy ? tooltipLabel : sprintf( __( '%1$s. %2$s' ), tooltipLabel, actionLabel );

	const handleClick = ( event: MouseEvent< HTMLButtonElement > ) => {
		event.stopPropagation();
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
						className={ clsx( styles.status, className ) }
						aria-label={ label }
						aria-busy={ busy || undefined }
						aria-disabled={ busy || undefined }
						data-state={ status }
						data-xdebug={ xdebug || undefined }
						onClick={ handleClick }
					>
						{ xdebug ? (
							<XdebugIcon className={ clsx( styles.glyph, styles.xdebugGlyph ) } />
						) : (
							<svg
								className={ styles.glyph }
								viewBox={ isStopped ? '0 0 10 10' : '0 0 8 8' }
								aria-hidden="true"
								focusable="false"
							>
								{ isStopped ? (
									<path className={ styles.playShape } d="M2.5 1 L9 5 L2.5 9 Z" />
								) : (
									<rect className={ styles.shape } x="0" y="0" width="8" height="8" />
								) }
							</svg>
						) }
						{ ! busy ? (
							site.running ? (
								<span className={ styles.actionGlyph } aria-hidden="true">
									<span className={ styles.pauseMark } />
								</span>
							) : (
								<svg
									className={ styles.actionGlyph }
									viewBox="0 0 10 10"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M2.5 1 L9 5 L2.5 9 Z" fill="currentColor" />
								</svg>
							)
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
