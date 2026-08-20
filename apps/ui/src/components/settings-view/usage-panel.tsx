import {
	clampQuotaFraction,
	getStudioCodeAiAccessState,
} from '@studio/common/lib/studio-assistant-quota';
import { __, _n, sprintf } from '@wordpress/i18n';
import { external, help, Icon, moreHorizontal } from '@wordpress/icons';
import { Button, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { SigninNotice } from '@/components/agentic-signin-banner';
import { AiAccessRequiredNotice, AiBlockedNotice } from '@/components/ai-access-required-notice';
import { AiCreditsDetailsDialog } from '@/components/ai-credits-details-dialog';
import * as Menu from '@/components/menu';
import { OfflineNotice } from '@/components/offline-banner';
import { PurchaseCreditsDialog } from '@/components/purchase-credits-dialog';
import { PURCHASE_CREDITS_PROTOTYPE_URL } from '@/components/purchase-credits-dialog/events';
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
import { creditsFromDollars, useUsageExploration } from '@/data/usage-exploration';
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

function UsageProgressBar( {
	fraction,
	valueClassName,
}: {
	fraction: number;
	valueClassName?: string;
} ) {
	const percentage = Math.round( fraction * 10_000 ) / 100;

	return (
		<div className={ styles.progressTrack } data-testid="usage-progress-bar" aria-hidden="true">
			<div
				className={ clsx( styles.progressValue, valueClassName ) }
				style={ { inlineSize: `${ percentage }%` } }
			/>
		</div>
	);
}

function getMeterIntent( fraction: number ): string | undefined {
	if ( fraction >= 1 ) {
		return styles.progressValueExhausted;
	}
	if ( fraction >= 0.9 ) {
		return styles.progressValueCritical;
	}
	if ( fraction >= 0.8 ) {
		return styles.progressValueWarning;
	}
	return undefined;
}

function CreditMeter( {
	remainingDollars,
	totalDollars,
	fraction,
	valueClassName,
}: {
	remainingDollars: number;
	totalDollars: number;
	fraction: number;
	valueClassName?: string;
} ) {
	const locale = useUserLocale();
	const credits = new Intl.NumberFormat( locale, { maximumFractionDigits: 0 } );
	const remainingCredits = creditsFromDollars( remainingDollars );
	const totalCredits = creditsFromDollars( totalDollars );
	const usedCredits = Math.max( 0, totalCredits - remainingCredits );

	return (
		<div className={ styles.creditMeter }>
			<div className={ styles.creditMeterSummary }>
				<span className={ styles.creditMeterCredits }>
					{ sprintf(
						/* translators: 1: AI credits used, 2: current meter baseline. */
						__( '%1$s of %2$s AI credits used' ),
						credits.format( usedCredits ),
						credits.format( totalCredits )
					) }
				</span>
				<strong className={ styles.creditMeterAvailable }>
					{ sprintf(
						/* translators: %s: number of AI credits still available. */
						__( '%s available' ),
						credits.format( remainingCredits )
					) }
				</strong>
			</div>
			<UsageProgressBar fraction={ fraction } valueClassName={ valueClassName } />
		</div>
	);
}

function AiCreditsSummary() {
	const usage = useUsageExploration();
	const connector = useConnector();
	const [ purchaseOpen, setPurchaseOpen ] = useState( false );
	const [ detailsOpen, setDetailsOpen ] = useState( false );
	const { data: quota } = useStudioAssistantQuota();
	const accessState = quota ? getStudioCodeAiAccessState( quota ) : 'available';
	const opensExternalCheckout = usage.purchaseCreditsFlow === 'external';
	const showWelcomeCredits = usage.purchasedTotal === 0 && usage.welcomeBalance > 0;
	let creditCalloutMessage: string = showWelcomeCredits
		? __( 'Your first 1.5 million AI credits are on us.' )
		: __( 'Keep the ideas flowing. Stock up for whatever you build next.' );
	if ( usage.isExhausted ) {
		creditCalloutMessage = __(
			'Your next idea is ready when you are. Top up to bring it to life.'
		);
	} else if ( usage.combinedFraction >= 0.9 ) {
		creditCalloutMessage = __( "You're on a roll. Top up now and keep building." );
	} else if ( usage.combinedFraction >= 0.8 ) {
		creditCalloutMessage = __( "Top up now so your next build doesn't stop short." );
	}
	const openPurchaseCredits = () => {
		if ( opensExternalCheckout ) {
			void connector.openExternalUrl( PURCHASE_CREDITS_PROTOTYPE_URL );
			return;
		}
		setPurchaseOpen( true );
	};
	const creditAction = (
		<div className={ styles.creditTopUpAction }>
			<Button
				className={ styles.creditTopUpButton }
				size="small"
				variant={ usage.isExhausted ? 'solid' : 'outline' }
				tone={ usage.isExhausted ? 'brand' : 'neutral' }
				onClick={ openPurchaseCredits }
			>
				{ opensExternalCheckout ? __( 'Purchase AI credits' ) : __( 'Add AI credits' ) }
				{ opensExternalCheckout ? <Icon icon={ external } size={ 14 } aria-hidden="true" /> : null }
			</Button>
			{ opensExternalCheckout ? <span>{ __( 'Checkout on WordPress.com' ) }</span> : null }
		</div>
	);

	return (
		<section className={ styles.usageSection }>
			<div className={ styles.usageSectionHeader }>
				<div className={ styles.aiCreditsHeading }>
					<h2>{ __( 'AI credits' ) }</h2>
					<Tooltip.Root>
						<Tooltip.Trigger
							render={
								<IconButton
									className={ styles.aiCreditsDetailsButton }
									icon={ help }
									label={ __( 'How AI credits work' ) }
									size="small"
									variant="minimal"
									tone="neutral"
									onClick={ () => setDetailsOpen( true ) }
								/>
							}
						/>
						<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
							{ __( 'How AI credits work' ) }
						</Tooltip.Popup>
					</Tooltip.Root>
				</div>
			</div>
			{ accessState !== 'available' ? (
				<div className={ styles.previewUsageText }>
					{ accessState === 'blocked' ? (
						<AiBlockedNotice />
					) : (
						<AiAccessRequiredNotice quota={ quota } />
					) }
				</div>
			) : (
				<>
					<CreditMeter
						remainingDollars={ usage.availableBalance }
						totalDollars={ usage.meterTotal }
						fraction={ usage.combinedFraction }
						valueClassName={ getMeterIntent( usage.combinedFraction ) }
					/>
					<div className={ styles.creditCallout }>
						{ creditAction }
						<span className={ styles.creditCalloutText }>{ creditCalloutMessage }</span>
					</div>
					<PurchaseCreditsDialog open={ purchaseOpen } onOpenChange={ setPurchaseOpen } />
				</>
			) }
			<AiCreditsDetailsDialog open={ detailsOpen } onOpenChange={ setDetailsOpen } />
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
	// Empty while loading: a bar still filled from the previous figure would
	// contradict the "Loading…" row next to it.
	const fraction = isLoadingPreviewUsage ? 0 : clampQuotaFraction( siteCount, siteLimit );
	const deletePreviewSitesLabel = deleteAllSnapshots.isPending
		? __( 'Deleting all preview sites…' )
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
							<Menu.Item destructive disabled={ isDisabled } onClick={ () => void handleDelete() }>
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
							? __( 'Loading…' )
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
					{ __( 'An error occurred while deleting all preview sites. Please try again.' ) }
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
			{ reason === 'signed-out' ? <SigninNotice source="settings" /> : null }
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
