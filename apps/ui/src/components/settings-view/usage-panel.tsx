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
import { useOffline } from '@/hooks/use-offline';
import styles from './style.module.css';

const DEFAULT_PREVIEW_SITE_LIMIT = 10;

function getDeletePreviewSitesLabel( isOffline: boolean, isDeleting: boolean ): string {
	if ( isOffline ) {
		return __( 'Deleting preview sites requires an internet connection.' );
	}
	if ( isDeleting ) {
		return __( 'Deleting preview sites...' );
	}
	return __( 'Delete all preview sites' );
}

function UsageProgressBar( { fraction }: { fraction: number } ) {
	return (
		<div className={ styles.progressTrack } aria-hidden="true">
			<div className={ styles.progressValue } style={ { inlineSize: `${ fraction * 100 }%` } } />
		</div>
	);
}

function AiCreditsSummary( { signedOut }: { signedOut: boolean } ) {
	const locale = useUserLocale();
	const isOffline = useOffline();
	const { data: quota, isLoading, isError } = useStudioAssistantQuota();

	let content;
	if ( signedOut ) {
		// Studio Code needs an account, so the Alpha pricing copy would be
		// telling signed-out users about credits they can't spend yet.
		content = <UsageProgressBar fraction={ 0 } />;
	} else if ( isLoading ) {
		content = <div className={ styles.previewUsageText }>{ __( 'Loading...' ) }</div>;
	} else if ( isError || ( isOffline && ! quota ) ) {
		// Offline without a cached quota reads the same as a failed fetch: we
		// have nothing to show, and the banner explains why.
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
	const isOffline = useOffline();
	const { data: snapshots, isLoading } = useSnapshots( userId );
	const { data: snapshotUsage, isLoading: isLoadingSnapshotUsage } = useSnapshotUsage( userId );
	const deleteAllSnapshots = useDeleteAllSnapshots( userId );
	const siteCount = snapshotUsage?.siteCount ?? snapshots?.length ?? 0;
	const siteLimit = snapshotUsage?.siteLimit ?? DEFAULT_PREVIEW_SITE_LIMIT;
	const snapshotCreationBlocked = snapshotUsage?.siteCreationBlocked ?? false;
	const isLoadingPreviewUsage = isLoading || isLoadingSnapshotUsage || deleteAllSnapshots.isPending;
	const isDisabled =
		siteCount === 0 || snapshotCreationBlocked || isLoadingPreviewUsage || isOffline;
	const fraction = clampQuotaFraction( siteCount, siteLimit );
	const deletePreviewSitesLabel = getDeletePreviewSitesLabel(
		isOffline,
		deleteAllSnapshots.isPending
	);

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
	const { data: user, isLoading } = useAuthUser();
	// Same signed-out/offline split the rest of the app banners use; both mean
	// the figures below can't be trusted, so they're dimmed either way.
	const { reason } = useAgenticFeatures();

	return (
		<div className={ styles.usagePanel }>
			<section
				className={ clsx( styles.settingsPanelSection, reason !== null && styles.usageDimmed ) }
			>
				<div className={ styles.settingsPanelHeader }>
					<h2>{ __( 'Usage' ) }</h2>
					<p>{ __( 'Track your preview site usage and Studio Code AI credits.' ) }</p>
				</div>
				{ reason !== null ? (
					<div className={ styles.usageNotice }>
						{ reason === 'offline' ? <OfflineNotice /> : <SigninNotice /> }
					</div>
				) : null }
				<AiCreditsSummary signedOut={ reason === 'signed-out' } />
				{ user ? (
					<PreviewSitesSummary userId={ user.id } />
				) : (
					<section className={ styles.usageSection }>
						<div className={ styles.usageSectionHeader }>
							<h2>{ __( 'Preview sites' ) }</h2>
						</div>
						{ isLoading ? (
							<div className={ styles.previewUsageText }>{ __( 'Loading...' ) }</div>
						) : (
							<UsageProgressBar fraction={ 0 } />
						) }
					</section>
				) }
			</section>
		</div>
	);
}
