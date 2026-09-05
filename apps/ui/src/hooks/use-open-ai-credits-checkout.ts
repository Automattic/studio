import { useCallback } from 'react';
import { markAiCreditsCheckoutPending } from '@/data/ai-credits-checkout';
import { useConnector } from '@/data/core';
import { useAddAiCreditsUrlBuilder } from '@/hooks/use-add-ai-credits-url';

/**
 * Opens WordPress.com checkout for a credits top-up and records that the user
 * has gone there. Every purchase entry point goes through here, so whichever
 * way the user comes back — the deeplink on desktop, a window focus in a
 * browser tab — the return has a trip to reconcile against.
 */
export function useOpenAiCreditsCheckout(): ( credits?: number ) => void {
	const connector = useConnector();
	const buildAddAiCreditsUrl = useAddAiCreditsUrlBuilder();
	return useCallback(
		( credits?: number ) => {
			markAiCreditsCheckoutPending();
			void connector.openExternalUrl( buildAddAiCreditsUrl( credits ) );
		},
		[ connector, buildAddAiCreditsUrl ]
	);
}
