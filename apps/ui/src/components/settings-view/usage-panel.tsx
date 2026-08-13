import {
	clampQuotaFraction,
	formatQuotaPercentage,
	formatQuotaResetDateShort,
	getStudioCodeAiAccessState,
} from '@studio/common/lib/studio-assistant-quota';
import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { SigninNotice } from '@/components/agentic-signin-banner';
import { AiAccessRequiredNotice, AiBlockedNotice } from '@/components/ai-access-required-notice';
import { OfflineNotice } from '@/components/offline-banner';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	useDeleteAllSnapshots,
	useSnapshotUsage,
	useSnapshots,
} from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
import styles from './style.module.css';
import type { ReactNode } from 'react';

const DEFAULT_PREVIEW_SITE_LIMIT = 10;

// Stands in for a figure we can't read: a hatched bar fills the row the real
// meter would occupy, so the section reads as disabled, not empty.
function UnavailableBar() {
	return <div className={ styles.unavailableBar } role="img" aria-label={ __( 'Unavailable' ) } />;
}

function Gauge( { fraction, value }: { fraction: number; value?: string } ) {
	const percentage = Math.min( 100, Math.max( 0, fraction * 100 ) );

	return (
		<div className={ styles.gauge }>
			<div className={ styles.progressTrack } data-testid="usage-progress-bar" aria-hidden="true">
				<div className={ styles.progressValue } style={ { inlineSize: `${ percentage }%` } } />
			</div>
			{ value !== undefined ? <span className={ styles.gaugeValue }>{ value }</span> : null }
		</div>
	);
}

function UsageSection( {
	title,
	meta,
	action,
	children,
}: {
	title: string;
	meta?: string;
	action?: ReactNode;
	children: ReactNode;
} ) {
	return (
		<section className={ styles.usageSection }>
			<div className={ styles.usageSectionHeader }>
				<h2>{ title }</h2>
				{ meta || action ? (
					<div className={ styles.usageSectionHeaderEnd }>
						{ meta ? <span className={ styles.usageMeta }>{ meta }</span> : null }
						{ action }
					</div>
				) : null }
			</div>
			{ children }
		</section>
	);
}

function UnavailableSection( { title }: { title: string } ) {
	return (
		<UsageSection title={ title }>
			<UnavailableBar />
		</UsageSection>
	);
}

function AiCreditsSummary() {
	const locale = useUserLocale();
	const { data: quota, isLoading, isError } = useStudioAssistantQuota();
	const accessState = quota ? getStudioCodeAiAccessState( quota ) : 'available';

	if ( isLoading ) {
		return (
			<UsageSection title={ __( 'AI credits' ) }>
				<Gauge fraction={ 0 } value={ __( 'Loading…' ) } />
			</UsageSection>
		);
	}

	if ( isError ) {
		return (
			<UsageSection title={ __( 'AI credits' ) }>
				<p className={ styles.previewUsageText }>
					{ __( 'Studio Code limits are temporarily unavailable.' ) }
				</p>
			</UsageSection>
		);
	}

	if ( accessState !== 'available' ) {
		return (
			<UsageSection title={ __( 'AI credits' ) }>
				<div className={ styles.previewUsageText }>
					{ accessState === 'blocked' ? (
						<AiBlockedNotice />
					) : (
						<AiAccessRequiredNotice quota={ quota } />
					) }
				</div>
			</UsageSection>
		);
	}

	if ( quota && quota.costCap > 0 ) {
		const fraction = clampQuotaFraction( quota.costUsage, quota.costCap );
		const wholePercent = Math.ceil( Number( ( fraction * 100 ).toFixed( 4 ) ) );
		return (
			<UsageSection
				title={ __( 'AI credits' ) }
				meta={ sprintf(
					/* translators: %s: date the monthly limit resets (e.g. Aug 1). */
					__( 'Resets %s' ),
					formatQuotaResetDateShort( quota.costResetDate, locale )
				) }
			>
				<Gauge
					fraction={ fraction }
					value={ formatQuotaPercentage( wholePercent / 100, locale ) }
				/>
			</UsageSection>
		);
	}

	return (
		<UsageSection title={ __( 'AI credits' ) } meta={ __( 'Free during Alpha' ) }>
			<div className={ clsx( styles.progressTrack, styles.aiCreditsTrack ) } aria-hidden="true">
				<div className={ styles.aiCreditsMeterValue } />
			</div>
		</UsageSection>
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
	// contradict the "Loading…" row next to it.
	const fraction = isLoadingPreviewUsage ? 0 : clampQuotaFraction( siteCount, siteLimit );
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
			<UsageSection title={ __( 'Preview sites' ) }>
				<p className={ styles.previewUsageText }>
					{ __( 'Preview sites are not available for your account.' ) }
				</p>
			</UsageSection>
		);
	}

	const value = isLoadingPreviewUsage
		? __( 'Loading…' )
		: sprintf(
				/* translators: 1: number of active preview sites, 2: maximum allowed. */
				__( '%1$d/%2$d' ),
				siteCount,
				siteLimit
		  );

	return (
		<UsageSection
			title={ __( 'Preview sites' ) }
			action={
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					size="small"
					aria-label={ __( 'Delete all preview sites' ) }
					disabled={ isDisabled }
					loading={ deleteAllSnapshots.isPending }
					loadingAnnouncement={ __( 'Deleting all preview sites…' ) }
					onClick={ () => void handleDelete() }
				>
					{ __( 'Reset' ) }
				</Button>
			}
		>
			<Gauge fraction={ fraction } value={ value } />
			{ deleteAllSnapshots.error ? (
				<div className={ styles.errorMessage }>
					{ __( 'An error occurred while deleting all preview sites. Please try again.' ) }
				</div>
			) : null }
		</UsageSection>
	);
}

export function UsagePanel() {
	const { data: user } = useAuthUser();
	const { reason } = useAgenticFeatures();

	return (
		<div className={ styles.usagePanel }>
			{ reason === 'offline' ? <OfflineNotice /> : null }
			{ reason === 'signed-out' ? <SigninNotice source="settings" /> : null }
			<UsageSummary userId={ user?.id } showDescription />
		</div>
	);
}

export function UsageSummary( {
	userId,
	showDescription = false,
}: {
	userId?: number;
	showDescription?: boolean;
} ) {
	// Signed-out and offline figures cannot be refreshed, so the summary uses
	// placeholders rather than presenting cached usage as current.
	const { reason } = useAgenticFeatures();
	const unavailable = reason !== null;

	return (
		<section className={ clsx( styles.card, unavailable && styles.usageDisabled ) }>
			<div className={ styles.settingsPanelHeader }>
				<h2>{ __( 'Usage' ) }</h2>
				{ showDescription ? (
					<p>{ __( 'Track your preview site usage and Studio Code AI credits.' ) }</p>
				) : null }
			</div>
			{ unavailable ? (
				<>
					<UnavailableSection title={ __( 'AI credits' ) } />
					<UnavailableSection title={ __( 'Preview sites' ) } />
				</>
			) : (
				<>
					<AiCreditsSummary />
					{ userId ? (
						<PreviewSitesSummary userId={ userId } />
					) : (
						<UnavailableSection title={ __( 'Preview sites' ) } />
					) }
				</>
			) }
		</section>
	);
}
