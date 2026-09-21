import {
	AI_CREDITS_CONFIRM_ATTEMPTS,
	AI_CREDITS_CONFIRM_INTERVAL_MS,
} from '@studio/common/lib/studio-assistant-quota';
import { useCallback, useRef } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useAppDispatch } from 'src/stores';
import { setAiCreditsAdded } from 'src/stores/ui-slice';
import { wpcomApi } from 'src/stores/wpcom-api';

// How long the confirmation stays on screen. A purchase note that outstays its
// welcome above the composer is worse than one the user misses.
const PURCHASE_NOTICE_TTL_MS = 8000;

/**
 * Confirms an AI credits top-up after WordPress.com checkout sends the user
 * back via wp-studio://ai-credits-purchased.
 *
 * Only a balance that grew counts: a cancelled checkout returns exactly like a
 * completed one, so the return itself proves nothing. Every other outcome is
 * silent, and the user is left where they were rather than pushed into the
 * settings — someone who bought from Settings → Usage is already looking at
 * the refreshed meter.
 *
 * The confirmation reads like a toast, so it leaves like one — and its clock
 * starts here, when the purchase lands, not when the composer that draws it
 * happens to mount. A top-up confirmed while Classic sits on Settings would
 * otherwise wait, and greet a session opened hours later as fresh news.
 */
export function useAiCreditsPurchasedListener() {
	const dispatch = useAppDispatch();
	const expiryTimer = useRef< ReturnType< typeof setTimeout > | undefined >( undefined );

	useIpcListener(
		'ai-credits-purchased',
		useCallback( () => {
			const readPurchased = async ( forceRefetch: boolean ) => {
				const request = dispatch(
					wpcomApi.endpoints.getStudioAssistantQuota.initiate( undefined, { forceRefetch } )
				);
				try {
					return ( await request ).data?.purchasedRemaining;
				} finally {
					request.unsubscribe();
				}
			};

			void ( async () => {
				// Nothing from before the trip means nothing to prove an increase
				// against; the balance still refreshes, but no claim is made.
				const before = await readPurchased( false );
				for ( let attempt = 0; attempt < AI_CREDITS_CONFIRM_ATTEMPTS; attempt++ ) {
					if ( attempt > 0 ) {
						await new Promise( ( resolve ) =>
							setTimeout( resolve, AI_CREDITS_CONFIRM_INTERVAL_MS )
						);
					}
					const after = await readPurchased( true );
					if ( before !== undefined && after !== undefined && after > before ) {
						dispatch( setAiCreditsAdded( after - before ) );
						clearTimeout( expiryTimer.current );
						expiryTimer.current = setTimeout(
							() => dispatch( setAiCreditsAdded( null ) ),
							PURCHASE_NOTICE_TTL_MS
						);
						return;
					}
				}
			} )();
		}, [ dispatch ] )
	);
}
