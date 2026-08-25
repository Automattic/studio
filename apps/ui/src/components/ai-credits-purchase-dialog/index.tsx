import {
	formatContinueForPriceLabel,
	formatPurchaseCreditsDescription,
	formatTopUpOptionCreditsLabel,
} from '@studio/common/lib/studio-assistant-top-up-pricing';
import { __ } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useAddAiCreditsUrlBuilder } from '@/hooks/use-add-ai-credits-url';
import styles from './style.module.css';

/**
 * One-time AI credit purchase. The amounts and their prices are the store's —
 * the grid renders whatever `/top-up-pricing` returns, in any number — and
 * picking one hands off to WordPress.com checkout for that quantity.
 *
 * Callers only open this when there are options to choose between; with none,
 * a chooser has nothing to show and the trigger goes straight to checkout for
 * the single fixed top-up instead.
 */
export function AiCreditsPurchaseDialog( {
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const connector = useConnector();
	const locale = useUserLocale();
	const buildAddAiCreditsUrl = useAddAiCreditsUrlBuilder();
	const { data: pricing } = useStudioAssistantTopUpPricing();
	const options = pricing?.options ?? [];
	const [ selectedCredits, setSelectedCredits ] = useState< number | null >( null );

	// Options arrive sorted cheapest-first, and the cheapest is the neutral
	// default — a mid-tier preselection is an upsell, which is the store's
	// call to make, not the client's. Resolved on render rather than stored,
	// so a price list that arrives late (or changes) can't leave the dialog
	// pointing at an amount that is no longer on offer.
	const selected =
		options.find( ( option ) => option.credits === selectedCredits ) ?? options[ 0 ] ?? null;

	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="small" initialFocus={ false }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'Add AI credits' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<Dialog.Description>{ formatPurchaseCreditsDescription() }</Dialog.Description>
					<div
						className={ styles.amountCards }
						role="radiogroup"
						aria-label={ __( 'AI credit amount' ) }
					>
						{ options.map( ( option ) => (
							<button
								key={ option.credits }
								type="button"
								role="radio"
								aria-checked={ option.credits === selected?.credits }
								className={ styles.amountOption }
								data-selected={ option.credits === selected?.credits ? '' : undefined }
								onClick={ () => setSelectedCredits( option.credits ) }
							>
								<span className={ styles.optionPrice }>{ option.display }</span>
								<span className={ styles.optionCredits }>
									{ formatTopUpOptionCreditsLabel( option, locale ) }
								</span>
							</button>
						) ) }
					</div>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral">
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						disabled={ ! selected }
						onClick={ () => {
							if ( ! selected ) {
								return;
							}
							void connector.openExternalUrl( buildAddAiCreditsUrl( selected.credits ) );
							onOpenChange( false );
						} }
					>
						{ selected ? formatContinueForPriceLabel( selected ) : __( 'Continue' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
