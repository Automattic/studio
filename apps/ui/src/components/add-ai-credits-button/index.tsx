import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { AiCreditsPurchaseDialog } from '@/components/ai-credits-purchase-dialog';
import { useConnector } from '@/data/core';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useAddAiCreditsUrlBuilder } from '@/hooks/use-add-ai-credits-url';
import type { ComponentProps } from 'react';

/**
 * The one way to buy AI credits, wherever the offer appears. With priced
 * amounts to choose between it opens the purchase dialog; with none — pricing
 * unavailable, or still loading — a chooser would have nothing to show, so it
 * goes straight to checkout for the single fixed top-up.
 */
export function AddAiCreditsButton( {
	className,
	variant = 'outline',
	tone = 'neutral',
}: {
	className?: string;
	variant?: ComponentProps< typeof Button >[ 'variant' ];
	tone?: ComponentProps< typeof Button >[ 'tone' ];
} ) {
	const connector = useConnector();
	const buildAddAiCreditsUrl = useAddAiCreditsUrlBuilder();
	const { data: pricing } = useStudioAssistantTopUpPricing();
	const [ dialogOpen, setDialogOpen ] = useState( false );
	const hasOptions = ( pricing?.options.length ?? 0 ) > 0;

	return (
		<>
			<Button
				className={ className }
				size="small"
				variant={ variant }
				tone={ tone }
				onClick={ () => {
					if ( hasOptions ) {
						setDialogOpen( true );
						return;
					}
					void connector.openExternalUrl( buildAddAiCreditsUrl() );
				} }
			>
				{ __( 'Add AI credits' ) }
			</Button>
			<AiCreditsPurchaseDialog open={ dialogOpen } onOpenChange={ setDialogOpen } />
		</>
	);
}
