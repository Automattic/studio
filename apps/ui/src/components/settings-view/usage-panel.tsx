import {
	clampQuotaFraction,
	formatQuotaPercentage,
	formatQuotaResetDate,
} from '@studio/common/lib/studio-assistant-quota';
import { __, _n, sprintf } from '@wordpress/i18n';
import { moreHorizontal } from '@wordpress/icons';
import { IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { SigninNotice } from '@/components/agentic-signin-banner';
import * as Menu from '@/components/menu';
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

const DEFAULT_PREVIEW_SITE_LIMIT = 10;

// Stands in for a figure we can't read: a hatched bar fills the row the real
// meter would occupy, so the section reads as disabled, not empty.
function UnavailableSection( { title }: { title: string } ) {
	return (
		<section className={ styles.usageSection }>
			<div className={ styles.usageSectionHeader }>
				<h2>{ title }</h2>
			</div>
			<div className={ styles.unavailableBar } role="img" aria-label={ __( 'Unavailable' ) } />
		</section>
	);
}

function UsageProgressBar( { fraction }: { fraction: number } ) {
	return (
		<div className={ styles.progressTrack } aria-hidden="true">
			<div className={ styles.progressValue } style={ { inlineSize: `${ fraction * 100 }%` } } />
		</div>
	);
}

function AiCreditsSummary() {
	const locale = useUserLocale();
	const { data: quota, isLoading, isError } = useStudioAssistantQuota();

	let content;
	if ( isLoading ) {
		content = <div className={ styles.previewUsageText }>{ __( 'Loading...' ) }</div>;
	} else if ( isError ) {
		content = (
			<div className={ styles.previewUsageText }>
				{ __( 'Studio Code limits are temporarily unavailable.' ) }
			</div>
		);
	} else if ( quota && quota.costCap > 0 ) {
		const fraction = clampQuotaFraction( quota.costUsage, quota.costCap );
		content = (
			<>
				<div className={ styles.previewUsageText }>
					{ sprintf(
						/* translators: %1$s: percentage of monthly limit used (e.g. 7.5%). %2$s: date the limit resets (e.g. July 1, 2026). */
						__( '%1$s of monthly limit used (resets on %2$s)' ),
						formatQuotaPercentage( fraction, locale ),
						formatQuotaResetDate( quota.costResetDate, locale )
					) }
				</div>
				<UsageProgressBar fraction={ fraction } />
			</>
		);
	} else {
		content = (
			<>
				<p>
					{ __(
						'AI credits are currently free while Studio Code is in Alpha. Build, iterate, and experiment, but know that credits will eventually have a cost.'
					) }
				</p>
				<div className={ clsx( styles.progressTrack, styles.aiCreditsTrack ) } aria-hidden="true">
					<div className={ styles.aiCreditsMeterValue } />
				</div>
			</>
		);
	}

	return (
		<section className={ styles.usageSection }>
			<div className={ styles.usageSectionHeader }>
				<h2>{ __( 'AI credits' ) }</h2>
			</div>
			{ content }
		</section>
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
	const fraction = clampQuotaFraction( siteCount, siteLimit );
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

	return (
		<section className={ styles.usageSection }>
			<div className={ styles.usageSectionHeader }>
				<h2>{ __( 'Preview sites' ) }</h2>
				{ ! snapshotCreationBlocked ? (
					<Menu.Root modal={ false }>
						<Menu.Trigger
							render={
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ moreHorizontal }
									label={ __( 'Preview site actions' ) }
									className={ styles.previewActionsButton }
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
				) : null }
			</div>
			{ snapshotCreationBlocked ? (
				<div className={ styles.previewUsageText }>
					{ __( 'Preview sites are not available for your account.' ) }
				</div>
			) : (
				<>
					<div className={ styles.previewUsageText }>
						{ isLoadingPreviewUsage
							? __( 'Loading...' )
							: sprintf(
									/* translators: 1: number of active preview sites, 2: maximum allowed */
									_n(
										'%1$d of %2$d active preview site',
										'%1$d of %2$d active preview sites',
										siteCount
									),
									siteCount,
									siteLimit
							  ) }
					</div>
					<UsageProgressBar fraction={ fraction } />
				</>
			) }
			{ deleteAllSnapshots.error ? (
				<div className={ styles.errorMessage }>
					{ __( 'An error occurred while deleting preview sites. Please try again.' ) }
				</div>
			) : null }
		</section>
	);
}

export function UsagePanel() {
	const { data: user } = useAuthUser();
	// Same signed-out/offline split the rest of the app banners use. Either way
	// the figures can't be read or refreshed, so the card goes disabled rather
	// than presenting a stale number as current.
	const { reason } = useAgenticFeatures();
	const unavailable = reason !== null;

	return (
		<div className={ styles.usagePanel }>
			{ reason === 'offline' ? <OfflineNotice /> : null }
			{ reason === 'signed-out' ? <SigninNotice /> : null }
			<section
				className={ clsx( styles.settingsPanelSection, unavailable && styles.usageDisabled ) }
			>
				<div className={ styles.settingsPanelHeader }>
					<h2>{ __( 'Usage' ) }</h2>
					<p>{ __( 'Track your preview site usage and Studio Code AI credits.' ) }</p>
				</div>
				{ unavailable ? (
					<>
						<UnavailableSection title={ __( 'AI credits' ) } />
						<UnavailableSection title={ __( 'Preview sites' ) } />
					</>
				) : (
					<>
						<AiCreditsSummary />
						{ user ? (
							<PreviewSitesSummary userId={ user.id } />
						) : (
							<UnavailableSection title={ __( 'Preview sites' ) } />
						) }
					</>
				) }
			</section>
		</div>
	);
}
