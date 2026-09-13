import {
	AI_CREDITS_CONFIRM_ATTEMPTS,
	AI_CREDITS_CONFIRM_INTERVAL_MS,
	formatAiCreditsAddedTitle,
} from '@studio/common/lib/studio-assistant-quota';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef } from 'react';
import {
	clearAiCreditsCheckoutPending,
	isAiCreditsCheckoutPending,
} from '@/data/ai-credits-checkout';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { ASSISTANT_QUOTA_QUERY_KEY } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useUserLocale } from '@/data/queries/use-user-locale';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

// One id for every outcome, so a repeated deeplink replaces the toast in place
// rather than stacking a second copy of the same news.
const PURCHASE_TOAST_ID = 'ai-credits-purchased';

/**
 * Confirms an AI credits top-up after the user comes back from WordPress.com.
 *
 * Only a balance that actually grew counts as a purchase — returning is not
 * evidence of one, and a cancelled checkout returns exactly like a completed
 * one. Every other outcome (cancelled, still pending past the poll, failed
 * purchase, failed refresh) is silent: a "didn't work" message after a
 * deliberate cancel is noise, and the balance on screen stays whatever the
 * last good fetch reported.
 */
export function useAiCreditsPurchaseResult(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const locale = useUserLocale();
	const { data: authUser } = useAuthUser();
	const userId = authUser?.id;
	const runningRef = useRef( false );

	const confirmPurchase = useCallback( async () => {
		if ( runningRef.current ) {
			return;
		}
		runningRef.current = true;
		const queryKey = [ ...ASSISTANT_QUOTA_QUERY_KEY, userId ];
		const readPurchased = () =>
			queryClient.getQueryData< StudioAssistantQuota >( queryKey )?.purchasedRemaining;
		// Without a figure from before the trip there is nothing to prove an
		// increase against, so the balance still refreshes but no claim is made.
		const before = readPurchased();
		try {
			for ( let attempt = 0; attempt < AI_CREDITS_CONFIRM_ATTEMPTS; attempt++ ) {
				if ( attempt > 0 ) {
					await new Promise( ( resolve ) => setTimeout( resolve, AI_CREDITS_CONFIRM_INTERVAL_MS ) );
				}
				await queryClient.refetchQueries( { queryKey } );
				const after = readPurchased();
				if ( before === undefined || after === undefined || after <= before ) {
					continue;
				}
				toast.success( formatAiCreditsAddedTitle( after - before, locale ), {
					id: PURCHASE_TOAST_ID,
					action: {
						label: __( 'View usage' ),
						onClick: () => void navigate( { to: '/settings', search: { tab: 'usage' } } ),
					},
				} );
				return;
			}
		} finally {
			clearAiCreditsCheckoutPending();
			runningRef.current = false;
		}
	}, [ locale, navigate, queryClient, userId ] );

	useEffect(
		() => connector.onAiCreditsPurchased( () => void confirmPurchase() ),
		[ connector, confirmPurchase ]
	);

	// The other end of the same trip: a browser tab can't receive the
	// wp-studio:// return at all, and on desktop the user may close the checkout
	// tab by hand instead of clicking through.
	useEffect( () => {
		const handleFocus = () => {
			if ( isAiCreditsCheckoutPending() ) {
				void confirmPurchase();
			}
		};
		window.addEventListener( 'focus', handleFocus );
		return () => window.removeEventListener( 'focus', handleFocus );
	}, [ confirmPurchase ] );
}
