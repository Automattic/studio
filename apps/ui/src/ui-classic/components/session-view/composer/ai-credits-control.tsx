import {
	getAiCreditsMeter,
	getAiCreditsMeterIntent,
	getStudioCodeAiAccessState,
	type AiCreditsMeterIntent,
} from '@studio/common/lib/studio-assistant-quota';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import { AiCreditsDetailsDialog } from '@/components/ai-credits-details-dialog';
import { AiCreditsPurchaseDialog } from '@/components/ai-credits-purchase-dialog';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import {
	ASSISTANT_QUOTA_QUERY_KEY,
	useStudioAssistantQuota,
} from '@/data/queries/use-assistant-quota';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useAddAiCreditsUrl } from '@/hooks/use-add-ai-credits-url';
import styles from './style.module.css';

// The ring arc draws the same used-over-total fraction as the Settings →
// Usage meter (`getAiCreditsMeter`, STU-2326), and its color escalates
// through the same intent steps. The meter resolves null when no denominator
// is measurable (e.g. billing unreachable) — there is no fraction to
// escalate on then, so the ring stays plain (or exhausted at zero balance)
// and the tooltip keeps carrying the figure.
function AiCreditsRing( {
	fillPercentage,
	intent,
}: {
	fillPercentage: number;
	intent: AiCreditsMeterIntent;
} ) {
	return (
		<svg
			className={ styles.aiCreditsRing }
			viewBox="0 0 24 24"
			width="20"
			height="20"
			fill="none"
			aria-hidden="true"
			data-intent={ intent === 'ok' ? undefined : intent }
		>
			<circle className={ styles.aiCreditsRingTrack } cx="12" cy="12" r="8" strokeWidth="2" />
			<circle
				className={ styles.aiCreditsRingValue }
				cx="12"
				cy="12"
				r="8"
				pathLength="100"
				strokeWidth="2"
				strokeDasharray="100"
				strokeDashoffset={ 100 - fillPercentage }
				strokeLinecap="round"
				transform="rotate(-90 12 12)"
			/>
		</svg>
	);
}

export function AiCreditsControl() {
	const connector = useConnector();
	const addAiCreditsUrl = useAddAiCreditsUrl();
	const locale = useUserLocale();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [ menuOpen, setMenuOpen ] = useState( false );
	const [ detailsOpen, setDetailsOpen ] = useState( false );
	const [ purchaseOpen, setPurchaseOpen ] = useState( false );
	const { data: quota } = useStudioAssistantQuota();
	// Mounted with the composer so the priced amounts are cached before the
	// menu opens and "Add AI credits" knows whether it has a choice to offer.
	const { data: pricing } = useStudioAssistantTopUpPricing();

	// The server includes the per-pool balances only when AI credits are
	// enabled for the account (STU-2235); without them the composer keeps its
	// pre-credits layout.
	if (
		! quota ||
		getStudioCodeAiAccessState( quota ) !== 'available' ||
		( quota.allowanceRemaining === undefined && quota.purchasedRemaining === undefined )
	) {
		return null;
	}

	const hasTopUpOptions = ( pricing?.options.length ?? 0 ) > 0;
	const remaining = ( quota.allowanceRemaining ?? 0 ) + ( quota.purchasedRemaining ?? 0 );
	const meter = getAiCreditsMeter( quota );
	const intent: AiCreditsMeterIntent = meter
		? getAiCreditsMeterIntent( meter.fraction )
		: remaining === 0
		? 'exhausted'
		: 'ok';
	const fillPercentage =
		intent === 'exhausted' ? 100 : meter ? Math.round( meter.fraction * 100 ) : 0;
	const formattedRemaining = new Intl.NumberFormat( locale ).format( remaining );
	const compactRemaining = new Intl.NumberFormat( locale, {
		notation: 'compact',
		maximumFractionDigits: 1,
	} ).format( remaining );
	const remainingLabel =
		remaining === 0
			? __( 'No AI credits remaining' )
			: sprintf(
					/* translators: %s: total number of AI credits remaining (e.g. 1,110,000). */
					__( '%s remaining' ),
					formattedRemaining
			  );
	const tooltipLabel =
		remaining === 0
			? __( 'AI credits · Out of credits' )
			: sprintf(
					/* translators: %s: compact number of AI credits remaining (e.g. 200K or 1.5M). */
					__( 'AI credits · %s remaining' ),
					compactRemaining
			  );

	return (
		<>
			<Menu.Root
				modal={ false }
				open={ menuOpen }
				onOpenChange={ ( open ) => {
					setMenuOpen( open );
					// The control never remounts, so opening the menu is its chance
					// to pull a balance changed outside the app (e.g. a purchase).
					if ( open ) {
						void queryClient.invalidateQueries( { queryKey: ASSISTANT_QUOTA_QUERY_KEY } );
					}
				} }
			>
				<Tooltip.Root disabled={ menuOpen }>
					<Menu.Trigger
						render={
							<Tooltip.Trigger
								render={
									<button
										type="button"
										className={ styles.iconButton }
										aria-label={ __( 'AI credits' ) }
									/>
								}
							>
								<AiCreditsRing fillPercentage={ fillPercentage } intent={ intent } />
							</Tooltip.Trigger>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
						{ tooltipLabel }
					</Tooltip.Popup>
				</Tooltip.Root>
				<Menu.Popup side="top" align="end">
					<div
						className={ styles.aiCreditsSummary }
						data-exhausted={ remaining === 0 || undefined }
					>
						<span>{ __( 'AI credits' ) }</span>
						<strong>{ remainingLabel }</strong>
					</div>
					<Menu.Separator />
					<Menu.Item
						onClick={ () => {
							// With priced amounts to choose between the picker opens;
							// with none it would be an empty dialog, so checkout for
							// the single fixed top-up takes over.
							if ( hasTopUpOptions ) {
								setPurchaseOpen( true );
								return;
							}
							void connector.openExternalUrl( addAiCreditsUrl );
						} }
					>
						{ __( 'Add AI credits' ) }
					</Menu.Item>
					<Menu.Item onClick={ () => setDetailsOpen( true ) }>
						{ __( 'How AI credits work' ) }
					</Menu.Item>
					<Menu.Item
						onClick={ () => void navigate( { to: '/settings', search: { tab: 'usage' } } ) }
					>
						{ __( 'Usage settings' ) }
					</Menu.Item>
				</Menu.Popup>
			</Menu.Root>
			<AiCreditsDetailsDialog open={ detailsOpen } onOpenChange={ setDetailsOpen } />
			<AiCreditsPurchaseDialog open={ purchaseOpen } onOpenChange={ setPurchaseOpen } />
		</>
	);
}
