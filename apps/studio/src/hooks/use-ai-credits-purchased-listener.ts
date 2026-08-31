import {
	AI_CREDITS_CONFIRM_ATTEMPTS,
	AI_CREDITS_CONFIRM_INTERVAL_MS,
} from '@studio/common/lib/studio-assistant-quota';
import { useCallback } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useAppDispatch } from 'src/stores';
import { setAiCreditsAdded } from 'src/stores/ui-slice';
import { wpcomApi } from 'src/stores/wpcom-api';

/**
 * Confirms an AI credits top-up after WordPress.com checkout sends the user
 * back via wp-studio://ai-credits-purchased.
 *
 * Only a balance that grew counts: a cancelled checkout returns exactly like a
 * completed one, so the return itself proves nothing. Every other outcome is
 * silent, and the user is left where they were rather than pushed into the
 * settings — someone who bought from Settings → Usage is already looking at
 * the refreshed meter.
 */
export function useAiCreditsPurchasedListener() {
	const dispatch = useAppDispatch();

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
						return;
					}
				}
			} )();
		}, [ dispatch ] )
	);
}
