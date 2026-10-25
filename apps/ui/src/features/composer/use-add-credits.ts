import { useState } from 'react';
import { useConnector } from '@/data/core';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useAddAiCreditsUrl } from '@/features/credits';

// The chooser when priced options exist, else straight to checkout for the
// single fixed top-up.
export function useAddCredits() {
	const connector = useConnector();
	const addAiCreditsUrl = useAddAiCreditsUrl();
	const { data: topUpPricing } = useStudioAssistantTopUpPricing();
	const [ purchaseOpen, setPurchaseOpen ] = useState( false );
	const openAddCredits = () => {
		if ( ( topUpPricing?.options.length ?? 0 ) > 0 ) {
			setPurchaseOpen( true );
			return;
		}
		void connector.openExternalUrl( addAiCreditsUrl );
	};
	return { openAddCredits, purchaseOpen, setPurchaseOpen };
}
