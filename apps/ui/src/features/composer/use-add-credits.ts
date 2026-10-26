import { useState, type RefObject } from 'react';
import { useConnector } from '@/data/core';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useAddAiCreditsUrl } from '@/features/credits';

// The chooser when priced options exist, else straight to checkout for the
// single fixed top-up. `returnFocus` is where focus goes when the chooser
// closes, for an opener that is gone by then, like the model menu.
export function useAddCredits() {
	const connector = useConnector();
	const addAiCreditsUrl = useAddAiCreditsUrl();
	const { data: topUpPricing } = useStudioAssistantTopUpPricing();
	const [ purchase, setPurchase ] = useState< {
		returnFocus?: RefObject< HTMLElement | null >;
	} | null >( null );
	const openAddCredits = ( returnFocus?: RefObject< HTMLElement | null > ) => {
		if ( ( topUpPricing?.options.length ?? 0 ) > 0 ) {
			setPurchase( { returnFocus } );
			return;
		}
		void connector.openExternalUrl( addAiCreditsUrl );
	};
	return { openAddCredits, purchase, closePurchase: () => setPurchase( null ) };
}
