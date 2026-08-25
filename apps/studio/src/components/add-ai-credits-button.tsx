import { getAddAiCreditsUrl } from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import { useState } from 'react';
import { AiCreditsPurchaseDialog } from 'src/components/ai-credits-purchase-dialog';
import Button from 'src/components/button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useGetStudioAssistantTopUpPricing } from 'src/stores/wpcom-api';
import type { ButtonVariant } from 'src/components/button';

/**
 * The one way to buy AI credits, wherever the offer appears. With priced
 * amounts to choose between it opens the purchase dialog; with none — pricing
 * unavailable, or still loading — a chooser would have nothing to show, so it
 * goes straight to checkout for the single fixed top-up and says so with the
 * external-link glyph.
 */
export function AddAiCreditsButton( {
	className,
	variant = 'secondary',
}: {
	className?: string;
	variant?: ButtonVariant;
} ) {
	const { data: pricing } = useGetStudioAssistantTopUpPricing();
	const [ dialogOpen, setDialogOpen ] = useState( false );
	const hasOptions = ( pricing?.options.length ?? 0 ) > 0;

	return (
		<>
			<Button
				className={ className }
				variant={ variant }
				size="small"
				icon={ hasOptions ? undefined : external }
				iconPosition="right"
				iconSize={ 16 }
				onClick={ () => {
					if ( hasOptions ) {
						setDialogOpen( true );
						return;
					}
					void getIpcApi().openURL( getAddAiCreditsUrl( { returnsToDesktop: true } ) );
				} }
			>
				{ __( 'Add AI credits' ) }
			</Button>
			<AiCreditsPurchaseDialog open={ dialogOpen } onOpenChange={ setDialogOpen } />
		</>
	);
}
