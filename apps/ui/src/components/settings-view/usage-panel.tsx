import {
	clampQuotaFraction,
	formatQuotaPercentage,
	formatQuotaResetDateShort,
} from '@studio/common/lib/studio-assistant-quota';
import { __, sprintf } from '@wordpress/i18n';
import { moreHorizontal } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import {
	useDeleteAllSnapshots,
	useSnapshotUsage,
	useSnapshots,
} from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { usePreviewAgenticFeatures } from './settings-preview';
import styles from './style.module.css';
import type { ReactNode } from 'react';

const DEFAULT_PREVIEW_SITE_LIMIT = 10;

// Stands in for a figure we can't read: a hatched bar fills the row the real
// meter would occupy, so the section reads as disabled, not empty.
function UnavailableBar() {
	return <div className={ styles.unavailableBar } role="img" aria-label={ __( 'Unavailable' ) } />;
}

// A thin pill bar with an optional value at its trailing end.
function Gauge( { fraction, value }: { fraction: number; value?: string } ) {
	const pct = Math.min( 100, Math.max( 0, fraction * 100 ) );
	return (
		<div className={ styles.gauge }>
			<div className={ styles.progressTrack } data-testid="usage-progress-bar" aria-hidden="true">
				<div className={ styles.progressValue } style={ { inlineSize: `${ pct }%` } } />
			</div>
			{ value !== undefined ? <span className={ styles.gaugeValue }>{ value }</span> : null }
		</div>
	);
}

// One usage meter: a title with right-aligned meta (or a menu) over a bar.
// Every readout in the account sidebar shares this shape.
function Meter( {
	title,
	meta,
	trailing,
	children,
	disabled,
}: {
	title: string;
	meta?: string;
	trailing?: ReactNode;
	children: ReactNode;
	disabled?: boolean;
} ) {
	return (
		<div className={ clsx( styles.meter, disabled && styles.usageDisabled ) }>
			<div className={ styles.meterHeader }>
				<h3 className={ styles.meterTitle }>{ title }</h3>
				{ meta || trailing ? (
					<div className={ styles.meterHeaderEnd }>
						{ meta ? <span className={ styles.meterMeta }>{ meta }</span> : null }
						{ trailing }
					</div>
				) : null }
			</div>
			{ children }
		</div>
	);
}

// Studio Code AI credit usage. A meter sub-section in the account sidebar, since
// credits are spent by the agent. Goes disabled whenever the figures can't be
// read (offline or signed out) rather than presenting a stale number as current.
export function AiCreditsSection() {
	const locale = useUserLocale();
	const { reason } = usePreviewAgenticFeatures();
	const { data: quota, isLoading, isError } = useStudioAssistantQuota();
	const unavailable = reason !== null;

	if ( unavailable ) {
		return (
			<Meter title={ __( 'AI credits' ) } disabled>
				<UnavailableBar />
			</Meter>
		);
	}

	if ( isLoading ) {
		return (
			<Meter title={ __( 'AI credits' ) }>
				<Gauge fraction={ 0 } />
			</Meter>
		);
	}

	if ( isError ) {
		return (
			<Meter title={ __( 'AI credits' ) }>
				<p className={ styles.meterText }>
					{ __( 'Studio Code limits are temporarily unavailable.' ) }
				</p>
			</Meter>
		);
	}

	if ( quota && quota.costCap > 0 ) {
		const fraction = clampQuotaFraction( quota.costUsage, quota.costCap );
		return (
			<Meter
				title={ __( 'AI credits' ) }
				meta={ sprintf(
					/* translators: %s: date the limit resets (e.g. Jul 31). */
					__( 'Reset %s' ),
					formatQuotaResetDateShort( quota.costResetDate, locale )
				) }
			>
				<Gauge fraction={ fraction } value={ formatQuotaPercentage( fraction, locale ) } />
			</Meter>
		);
	}

	// Alpha: no cost cap yet, so there's no figure — a hatched brand bar stands in
	// while credits are free.
	return (
		<Meter title={ __( 'AI credits' ) } meta={ __( 'Free during Alpha' ) }>
			<div className={ clsx( styles.progressTrack, styles.aiCreditsTrack ) } aria-hidden="true">
				<div className={ styles.aiCreditsMeterValue } />
			</div>
		</Meter>
	);
}

function PreviewSitesSummary( { userId }: { userId: number } ) {
	const connector = useConnector();
	const { data: snapshots, isLoading } = useSnapshots( userId );
	const { data: snapshotUsage, isLoading: isLoadingSnapshotUsage } = useSnapshotUsage( userId );
	const deleteAllSnapshots = useDeleteAllSnapshots( userId );
	const siteCount = snapshotUsage?.siteCount ?? snapshots?.length ?? 0;
	const siteLimit = snapshotUsage?.siteLimit ?? DEFAULT_PREVIEW_SITE_LIMIT;
	const snapshotCreationBlocked = snapshotUsage?.siteCreationBlocked ?? false;
	const isLoadingPreviewUsage = isLoading || isLoadingSnapshotUsage || deleteAllSnapshots.isPending;
	const isDisabled = siteCount === 0 || snapshotCreationBlocked || isLoadingPreviewUsage;
	// Empty while loading: a bar still filled from the previous figure would
	// contradict the "Loading..." row next to it.
	const fraction = isLoadingPreviewUsage ? 0 : clampQuotaFraction( siteCount, siteLimit );
	const deletePreviewSitesLabel = deleteAllSnapshots.isPending
		? __( 'Deleting preview sites...' )
		: __( 'Delete all preview sites' );

	const handleDelete = async () => {
		if ( isDisabled ) {
			return;
		}
		const confirmed = await connector.confirmDeleteAllPreviewSites();
		if ( confirmed ) {
			deleteAllSnapshots.mutate();
		}
	};

	if ( snapshotCreationBlocked ) {
		return (
			<Meter title={ __( 'Preview sites' ) }>
				<p className={ styles.meterText }>
					{ __( 'Preview sites are not available for your account.' ) }
				</p>
			</Meter>
		);
	}

	const value = isLoadingPreviewUsage
		? __( 'Loading...' )
		: sprintf(
				/* translators: 1: number of active preview sites, 2: maximum allowed. */
				__( '%1$d of %2$d' ),
				siteCount,
				siteLimit
		  );

	return (
		<Meter
			title={ __( 'Preview sites' ) }
			trailing={
				<Menu.Root modal={ false }>
					<Menu.Trigger
						render={
							<IconButton
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ moreHorizontal }
								label={ __( 'Preview site actions' ) }
								className={ styles.meterActionsButton }
								disabled={ isDisabled }
							/>
						}
					/>
					<Menu.Popup side="bottom" align="end">
						<Menu.Item disabled={ isDisabled } onClick={ () => void handleDelete() }>
							{ deletePreviewSitesLabel }
						</Menu.Item>
					</Menu.Popup>
				</Menu.Root>
			}
		>
			<Gauge fraction={ fraction } value={ value } />
			{ deleteAllSnapshots.error ? (
				<div className={ styles.errorMessage }>
					{ __( 'An error occurred while deleting preview sites. Please try again.' ) }
				</div>
			) : null }
		</Meter>
	);
}

// Preview-site usage as a row inside the account sidebar. The sidebar only
// renders it for a signed-in user, so the sole unreadable state that reaches
// here is offline — swap in a hatched placeholder rather than a stale count.
export function PreviewUsageSection( { userId }: { userId: number } ) {
	const { reason } = usePreviewAgenticFeatures();

	if ( reason === 'offline' ) {
		return (
			<Meter title={ __( 'Preview sites' ) } disabled>
				<UnavailableBar />
			</Meter>
		);
	}

	return <PreviewSitesSummary userId={ userId } />;
}
