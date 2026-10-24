import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { AiCreditsPurchaseDialog } from '@/components/ai-credits-purchase-dialog';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useOpenAiCreditsCheckout } from '@/hooks/use-open-ai-credits-checkout';

/**
 * The one way to buy AI credits, wherever the offer appears. With priced
 * amounts to choose between it opens the purchase dialog; with none — pricing
 * unavailable, or still loading — a chooser would have nothing to show, so it
 * goes straight to checkout for the single fixed top-up.
 */
export function AddAiCreditsButton( {
	className,
	variant = 'outline',
	size,
}: Pick< ButtonProps, 'className' | 'variant' | 'size' > ) {
	const openCheckout = useOpenAiCreditsCheckout();
	const { data: pricing } = useStudioAssistantTopUpPricing();
	const [ dialogOpen, setDialogOpen ] = useState( false );
	const hasOptions = ( pricing?.options.length ?? 0 ) > 0;

	return (
		<>
			<Button
				className={ className }
				variant={ variant }
				size={ size }
				onClick={ () => {
					if ( hasOptions ) {
						setDialogOpen( true );
						return;
					}
					openCheckout();
				} }
			>
				{ __( 'Add AI credits' ) }
			</Button>
			<AiCreditsPurchaseDialog open={ dialogOpen } onOpenChange={ setDialogOpen } />
		</>
	);
}
