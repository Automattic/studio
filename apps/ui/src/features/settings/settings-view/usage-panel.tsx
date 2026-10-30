import {
	clampQuotaFraction,
	formatAiCreditsCallout,
	formatQuotaPercentage,
	formatQuotaResetDate,
	getAiCreditsMeter,
	getAiCreditsMeterIntent,
	getStudioCodeAiAccessState,
} from '@studio/common/lib/studio-assistant-quota';
import { __, _n, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { CircleHelpIcon, EllipsisIcon } from 'lucide-react';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	useDeleteAllSnapshots,
	useSnapshotUsage,
	useSnapshots,
} from '@/data/queries/use-snapshots';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useUserLocale } from '@/data/queries/use-user-locale';
import {
	AiCreditsDetailsDialog,
	AiAccessRequiredNotice,
	AiBlockedNotice,
	useOpenAiCreditsCheckout,
} from '@/features/credits';
import { LearnMoreLink } from '@/features/onboarding';
import { SigninNotice } from '@/features/settings/agentic-signin-banner';
import { OfflineNotice } from '@/features/settings/offline-banner';
import { Progress, Menu, Field, FieldDescription, FieldTitle, Button, IconButton } from '@/lib/ui';
import { SettingsGroup, SettingsRow, SettingsSelect } from './rows';
import styles from './style.module.css';
import type { AiCreditsMeterIntent } from '@studio/common/lib/studio-assistant-quota';
import type { ReactNode } from 'react';

const DEFAULT_PREVIEW_SITE_LIMIT = 10;

// Stands in for a figure we can't read: a hatched bar fills the row the real
// meter would occupy, so the section reads as disabled, not empty.
function UnavailableMeter() {
	return <div className={ styles.unavailableBar } role="img" aria-label={ __( 'Unavailable' ) } />;
}

function UsageProgressBar( {
	fraction,
	intent = 'ok',
}: {
	fraction: number;
	intent?: AiCreditsMeterIntent;
} ) {
	return (
		<Progress
			value={ fraction * 100 }
			intent={ intent === 'ok' ? undefined : intent }
			aria-hidden="true"
		/>
	);
}

// A meter row: its figure on the left, a secondary figure on the right, the bar below.
function MeterRow( {
	label,
	detail,
	settingId,
	children,
}: {
	label: ReactNode;
	detail?: ReactNode;
	// Lets search and settings links reveal the row.
	settingId?: string;
	children?: ReactNode;
} ) {
	return (
		<Field
			className={ styles.meterRow }
			data-settings-row={ settingId ? '' : undefined }
			data-setting-id={ settingId }
		>
			<div className={ styles.meterSummary }>
				<FieldTitle className={ styles.meterLabel }>{ label }</FieldTitle>
				{ detail ? <FieldDescription width="full">{ detail }</FieldDescription> : null }
			</div>
			{ children }
		</Field>
	);
}

function CreditPurchaseRow() {
	const locale = useUserLocale();
	const openCheckout = useOpenAiCreditsCheckout();
	const { data: pricing, isLoading } = useStudioAssistantTopUpPricing();
	const options = pricing?.options ?? [];
	const [ credits, setCredits ] = useState< string | null >( null );
	const selected =
		options.find( ( option ) => String( option.credits ) === credits ) ?? options[ 0 ];
	return (
		<SettingsRow
			title={ __( 'Add credits' ) }
			description={ __( 'Get more WordPress.com AI credits to keep building.' ) }
		>
			{ options.length ? (
				<SettingsSelect
					label={ __( 'AI credits' ) }
					value={ String( selected.credits ) }
					options={ options.map( ( option ) => ( {
						value: String( option.credits ),
						label: `${ new Intl.NumberFormat( locale ).format( option.credits ) } — ${
							option.display
						}`,
					} ) ) }
					onChange={ setCredits }
				/>
			) : null }
			<Button disabled={ isLoading } onClick={ () => openCheckout( selected?.credits ) }>
				{ __( 'Buy credits' ) }
			</Button>
		</SettingsRow>
	);
}

function AiCreditsHelp() {
	const [ open, setOpen ] = useState( false );
	return (
		<>
			<IconButton
				size="icon-2xs"
				variant="muted-ghost"
				icon={ <CircleHelpIcon /> }
				label={ __( 'How AI credits work' ) }
				onClick={ () => setOpen( true ) }
			/>
			<AiCreditsDetailsDialog open={ open } onOpenChange={ setOpen } />
		</>
	);
}

function AiCreditsRows() {
	const locale = useUserLocale();
	// The balance may have changed outside the app (e.g. a credits purchase on
	// WordPress.com), so opening the panel always fetches a fresh figure.
	const {
		data: quota,
		isLoading,
		isError,
		refetch,
	} = useStudioAssistantQuota( { refetchOnMount: 'always' } );
	const accessState = quota ? getStudioCodeAiAccessState( quota ) : 'available';
	// The server includes the per-pool balances only when AI credits are
	// enabled for the account (STU-2235); their absence — not a 0 — means the
	// pre-credits design should render.
	const showsCreditBalances =
		! isLoading &&
		! isError &&
		accessState === 'available' &&
		!! quota &&
		( quota.allowanceRemaining !== undefined || quota.purchasedRemaining !== undefined );

	if ( isLoading ) {
		return (
			<MeterRow label={ __( 'Loading…' ) }>
				<UsageProgressBar fraction={ 0 } />
			</MeterRow>
		);
	}
	if ( isError ) {
		return (
			<MeterRow label={ __( 'AI usage is currently unavailable.' ) }>
				<div>
					<Button variant="ghost" onClick={ () => void refetch() }>
						{ __( 'Try again' ) }
					</Button>
				</div>
			</MeterRow>
		);
	}
	if ( accessState !== 'available' ) {
		return (
			<Field>
				<FieldDescription width="full">
					{ accessState === 'blocked' ? (
						<AiBlockedNotice />
					) : (
						<AiAccessRequiredNotice quota={ quota } />
					) }
				</FieldDescription>
			</Field>
		);
	}
	if ( quota && showsCreditBalances ) {
		const meter = getAiCreditsMeter( quota );
		const intent = meter ? getAiCreditsMeterIntent( meter.fraction ) : 'ok';
		const credits = new Intl.NumberFormat( locale );
		return (
			<>
				{ meter ? (
					<MeterRow
						label={
							<>
								{ sprintf(
									/* translators: %s: number of AI credits still available (e.g. 300,000). */
									__( '%s credits remaining' ),
									credits.format( meter.remainingCredits )
								) }
								<AiCreditsHelp />
							</>
						}
						detail={ sprintf(
							/* translators: %s: share of the AI credits used, as a percentage (e.g. 61.14%). */
							__( '%s used' ),
							formatQuotaPercentage( meter.fraction, locale )
						) }
					>
						<UsageProgressBar fraction={ meter.fraction } intent={ intent } />
						<FieldDescription width="full">
							{ formatAiCreditsCallout( quota, meter, locale ) }
						</FieldDescription>
					</MeterRow>
				) : (
					// No usable denominator (e.g. billing unreachable): plain
					// figures instead of a bar, and only the known ones.
					<Field className={ styles.meterRow }>
						<FieldTitle>
							{ __( 'AI credits' ) }
							<AiCreditsHelp />
						</FieldTitle>
						{ quota.allowanceRemaining !== undefined ? (
							<FieldDescription width="full">
								{ sprintf(
									/* translators: %s: number of free AI credits remaining (e.g. 960,000). */
									__( 'Free credits remaining: %s' ),
									credits.format( quota.allowanceRemaining )
								) }
							</FieldDescription>
						) : null }
						{ quota.purchasedRemaining !== undefined ? (
							<FieldDescription width="full">
								{ sprintf(
									/* translators: %s: number of purchased AI credits remaining (e.g. 150,000). */
									__( 'Purchased credits remaining: %s' ),
									credits.format( quota.purchasedRemaining )
								) }
							</FieldDescription>
						) : null }
					</Field>
				) }
				{ quota.hasPaymentMethod ? <CreditPurchaseRow /> : null }
			</>
		);
	}
	if ( quota && quota.costCap > 0 ) {
		const fraction = clampQuotaFraction( quota.costUsage, quota.costCap );
		return (
			<MeterRow
				label={
					quota.costResetDate
						? sprintf(
								/* translators: %1$s: percentage of monthly limit used (e.g. 7.5%). %2$s: date the limit resets (e.g. July 1, 2026). */
								__( '%1$s of monthly limit used (resets on %2$s)' ),
								formatQuotaPercentage( fraction, locale ),
								formatQuotaResetDate( quota.costResetDate, locale )
						  )
						: sprintf(
								/* translators: %s: percentage of monthly limit used (e.g. 7.5%). */
								__( '%s of monthly limit used' ),
								formatQuotaPercentage( fraction, locale )
						  )
				}
			>
				<UsageProgressBar fraction={ fraction } />
			</MeterRow>
		);
	}
	return (
		<MeterRow
			label={ __(
				'AI credits are currently free while Studio Code is in Alpha. Build, iterate, and experiment, but know that credits will eventually have a cost.'
			) }
		>
			<div className={ styles.aiCreditsTrack } aria-hidden="true" />
		</MeterRow>
	);
}

function PreviewSitesRow( { userId }: { userId: number } ) {
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

	if ( snapshotCreationBlocked ) {
		return (
			<MeterRow
				settingId="preview-site-usage"
				label={ __( 'Preview sites are not available for your account.' ) }
			/>
		);
	}
	return (
		<MeterRow
			settingId="preview-site-usage"
			label={
				isLoadingPreviewUsage
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
					  )
			}
			detail={
				<Menu.Root modal={ false }>
					<Menu.Trigger
						render={
							<IconButton
								size="icon-sm"
								icon={ <EllipsisIcon /> }
								label={ __( 'Preview site actions' ) }
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
			}
		>
			<UsageProgressBar fraction={ fraction } />
			{ deleteAllSnapshots.error ? (
				<FieldDescription
					width="full"
					error={ __( 'An error occurred while deleting all preview sites. Please try again.' ) }
				/>
			) : null }
		</MeterRow>
	);
}

export function PreviewSitesUsage() {
	const { data: user } = useAuthUser();
	const { reason } = useAgenticFeatures();
	const unavailable = reason !== null || ! user;
	return (
		<div className={ unavailable ? styles.usageDisabled : undefined }>
			<SettingsGroup title={ __( 'Usage' ) }>
				{ unavailable ? (
					<Field>
						<UnavailableMeter />
					</Field>
				) : (
					<PreviewSitesRow userId={ user.id } />
				) }
			</SettingsGroup>
		</div>
	);
}

export function UsagePanel() {
	// Same signed-out/offline split the rest of the app banners use. Either way
	// the figures can't be read or refreshed, so the meters go disabled rather
	// than presenting a stale number as current.
	const { reason } = useAgenticFeatures();
	const unavailable = reason !== null;

	return (
		<div className={ clsx( styles.preferencesPanel, unavailable && styles.usageDisabled ) }>
			{ reason === 'offline' ? <OfflineNotice /> : null }
			{ reason === 'signed-out' ? <SigninNotice source="settings" /> : null }
			<SettingsGroup>
				<SettingsRow
					title={ __( 'WordPress.com AI' ) }
					description={
						<>
							{ __(
								'Bring your WordPress ideas to life through conversation. Use AI credits to build sites, shape content, and refine your design. A one-time free allowance helps you get started.'
							) }{ ' ' }
							<LearnMoreLink docsLinksKey="docsAiCredits" />
						</>
					}
				/>
				{ unavailable ? (
					<Field>
						<UnavailableMeter />
					</Field>
				) : (
					<AiCreditsRows />
				) }
			</SettingsGroup>
			<PreviewSitesUsage />
		</div>
	);
}
