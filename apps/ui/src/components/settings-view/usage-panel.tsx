import { clampQuotaFraction } from '@studio/common/lib/studio-assistant-quota';
import { __, _n, sprintf } from '@wordpress/i18n';
import { moreHorizontal } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { SigninNotice } from '@/components/agentic-signin-banner';
import * as Menu from '@/components/menu';
import { OfflineNotice } from '@/components/offline-banner';
import { PurchaseCreditsDialog } from '@/components/purchase-credits-dialog';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	useDeleteAllSnapshots,
	useSnapshotUsage,
	useSnapshots,
} from '@/data/queries/use-snapshots';
import { useUserLocale } from '@/data/queries/use-user-locale';
import {
	creditsFromDollars,
	setUsageExplorationScenario,
	useUsageExploration,
	type UsageExplorationScenario,
} from '@/data/usage-exploration';
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
	return (
		<div className={ styles.progressTrack } data-testid="usage-progress-bar" aria-hidden="true">
			<div
				className={ clsx( styles.progressValue, valueClassName ) }
				style={ { inlineSize: `${ fraction * 100 }%` } }
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

// Dollars lead because that is what the account is actually charged; the credit
// count sits underneath as the unit the assistant spends.
function CreditMeter( {
	label,
	remainingDollars,
	usedDollars,
	totalDollars,
	fraction,
	valueClassName,
}: {
	label: string;
	remainingDollars: number;
	usedDollars: number;
	totalDollars: number;
	fraction: number;
	valueClassName?: string;
} ) {
	const locale = useUserLocale();
	const currency = new Intl.NumberFormat( locale, { style: 'currency', currency: 'USD' } );
	const credits = new Intl.NumberFormat( locale, { maximumFractionDigits: 0 } );

	return (
		<div className={ styles.creditMeter }>
			<div className={ styles.creditMeterHeader }>
				<span>{ label }</span>
				<span className={ styles.creditMeterValue }>
					{ sprintf(
						/* translators: %s: dollar value of the AI credits still available. */
						__( '%s left' ),
						currency.format( remainingDollars )
					) }
				</span>
			</div>
			<UsageProgressBar fraction={ fraction } valueClassName={ valueClassName } />
			<span className={ styles.creditMeterCredits }>
				{ sprintf(
					/* translators: 1: AI credits used, 2: total AI credits available. */
					__( '%1$s of %2$s credits used' ),
					credits.format( creditsFromDollars( usedDollars ) ),
					credits.format( creditsFromDollars( totalDollars ) )
				) }
			</span>
		</div>
	);
}

function AiCreditsSummary() {
	const usage = useUsageExploration();
	const [ purchaseOpen, setPurchaseOpen ] = useState( false );
	const purchasedUsed = usage.purchasedTotal - usage.purchasedBalance;
	const monthlyRemaining = Math.max( 0, usage.monthlyLimit - usage.monthlyUsed );
	const monthlyMeterIntent =
		usage.purchasedTotal > 0 ? undefined : getMeterIntent( usage.monthlyFraction );

	return (
		<section className={ styles.usageSection }>
			<div className={ styles.usageSectionHeader }>
				<h2>{ __( 'AI credits' ) }</h2>
			</div>
			<CreditMeter
				label={ __( 'Monthly allowance' ) }
				remainingDollars={ monthlyRemaining }
				usedDollars={ usage.monthlyUsed }
				totalDollars={ usage.monthlyLimit }
				fraction={ usage.monthlyFraction }
				valueClassName={ monthlyMeterIntent }
			/>
			{ usage.purchasedTotal > 0 ? (
				<CreditMeter
					label={ __( 'Extra AI credits' ) }
					remainingDollars={ usage.purchasedBalance }
					usedDollars={ purchasedUsed }
					totalDollars={ usage.purchasedTotal }
					fraction={ usage.purchasedFraction }
					valueClassName={ getMeterIntent( usage.purchasedFraction ) }
				/>
			) : (
				<div className={ styles.creditTopUpText }>
					<strong>
						{ usage.isExhausted
							? __( 'Keep chatting with extra credits' )
							: __( 'Extra AI credits' ) }
					</strong>
					<p>
						{ usage.isExhausted
							? __( 'Add credits to continue now. Extra credits do not expire.' )
							: __( 'Add more credits in case you go over your allowance.' ) }
					</p>
				</div>
			) }
			<Button
				className={ styles.creditTopUpButton }
				size="small"
				variant="outline"
				tone="neutral"
				onClick={ () => setPurchaseOpen( true ) }
			>
				{ __( 'Add credits' ) }
			</Button>
			<PurchaseCreditsDialog open={ purchaseOpen } onOpenChange={ setPurchaseOpen } />
		</section>
	);
}

const MONTHLY_EXPLORATION_SCENARIOS: Array< {
	value: UsageExplorationScenario;
	label: string;
} > = [
	{ value: 'healthy', label: '36%' },
	{ value: 'warning', label: '80%' },
	{ value: 'critical', label: '90%' },
	{ value: 'exhausted', label: '100%' },
];

const EXTRA_EXPLORATION_SCENARIOS: Array< {
	value: UsageExplorationScenario;
	label: string;
} > = [
	{ value: 'extra-reserve', label: __( 'In reserve' ) },
	{ value: 'extra-healthy', label: '36%' },
	{ value: 'extra-warning', label: '80%' },
	{ value: 'extra-critical', label: '90%' },
	{ value: 'extra-exhausted', label: '100%' },
];

function ExplorationScenarioRow( {
	label,
	options,
	selected,
}: {
	label: string;
	options: Array< { value: UsageExplorationScenario; label: string } >;
	selected: UsageExplorationScenario;
} ) {
	return (
		<div className={ styles.explorationScenarioRow }>
			<span>{ label }</span>
			<div className={ styles.explorationButtons }>
				{ options.map( ( option ) => (
					<button
						key={ option.value }
						type="button"
						className={ styles.explorationButton }
						data-selected={ selected === option.value ? '' : undefined }
						aria-label={ `${ label } ${ option.label }` }
						onClick={ () => setUsageExplorationScenario( option.value ) }
					>
						{ option.label }
					</button>
				) ) }
			</div>
		</div>
	);
}

function UsageExplorationControls() {
	const { scenario } = useUsageExploration();
	return (
		<section className={ clsx( styles.usageSection, styles.explorationControls ) }>
			<div>
				<strong>{ __( 'Prototype state' ) }</strong>
				<p>{ __( 'Switch between usage conditions to review each interface.' ) }</p>
			</div>
			<div className={ styles.explorationScenarioRows }>
				<ExplorationScenarioRow
					label={ __( 'Monthly allowance' ) }
					options={ MONTHLY_EXPLORATION_SCENARIOS }
					selected={ scenario }
				/>
				<ExplorationScenarioRow
					label={ __( 'Extra credits' ) }
					options={ EXTRA_EXPLORATION_SCENARIOS }
					selected={ scenario }
				/>
			</div>
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
						<UsageExplorationControls />
					</>
				) }
			</section>
		</div>
	);
}
