import { getAddAiCreditsUrl } from '@studio/common/lib/studio-assistant-quota';
import {
	formatContinueForPriceLabel,
	formatPurchaseCreditsDescription,
	formatTopUpOptionCreditsLabel,
	formatTopUpOptionPriceLabel,
} from '@studio/common/lib/studio-assistant-top-up-pricing';
import { __ } from '@wordpress/i18n';
import { Dialog } from '@wordpress/ui';
import { useState } from 'react';
import Button from 'src/components/button';
import dialogDefense from 'src/components/studio-code-session/wp-ui-dialog-defense.module.css';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useI18nLocale } from 'src/stores';
import { useGetStudioAssistantTopUpPricing } from 'src/stores/wpcom-api';

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
	const locale = useI18nLocale();
	const { data: pricing } = useGetStudioAssistantTopUpPricing();
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
			<Dialog.Popup size="small" initialFocus={ false } className={ dialogDefense.popup }>
				<Dialog.Header>
					<Dialog.Title>{ __( 'Add AI credits' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<Dialog.Description>{ formatPurchaseCreditsDescription() }</Dialog.Description>
					<div
						className="mt-4 grid grid-cols-2 gap-2"
						role="radiogroup"
						aria-label={ __( 'AI credit amount' ) }
					>
						{ options.map( ( option ) => {
							const isSelected = option.credits === selected?.credits;
							return (
								<button
									key={ option.credits }
									type="button"
									role="radio"
									aria-checked={ isSelected }
									className={ cx(
										'flex flex-col items-start gap-1 rounded-lg border p-3 text-left',
										'bg-frame-surface',
										isSelected
											? 'border-transparent ring-2 ring-inset ring-frame-theme'
											: 'border-frame-border hover:border-frame-text-secondary'
									) }
									onClick={ () => setSelectedCredits( option.credits ) }
								>
									<span className="text-frame-text text-base font-semibold">
										{ formatTopUpOptionCreditsLabel( option, locale ) }
									</span>
									<span className="text-frame-text-secondary text-xs">
										{ formatTopUpOptionPriceLabel( option ) }
									</span>
								</button>
							);
						} ) }
					</div>
				</Dialog.Content>
				<Dialog.Footer>
					<Button variant="tertiary" onClick={ () => onOpenChange( false ) }>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						variant="primary"
						disabled={ ! selected }
						onClick={ () => {
							if ( ! selected ) {
								return;
							}
							void getIpcApi().openURL(
								getAddAiCreditsUrl( { returnsToDesktop: true, credits: selected.credits } )
							);
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
