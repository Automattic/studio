import {
	formatContinueForPriceLabel,
	formatTopUpOptionCreditsLabel,
} from '@studio/common/lib/studio-assistant-top-up-pricing';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { useRef, useState, type KeyboardEvent } from 'react';
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
	const optionRefs = useRef< Array< HTMLButtonElement | null > >( [] );

	// Options arrive sorted cheapest-first, and the cheapest is the neutral
	// default — a mid-tier preselection is an upsell, which is the store's
	// call to make, not the client's. Resolved on render rather than stored,
	// so a price list that arrives late (or changes) can't leave the dialog
	// pointing at an amount that is no longer on offer.
	const selected =
		options.find( ( option ) => option.credits === selectedCredits ) ?? options[ 0 ] ?? null;
	const selectOption = ( index: number ) => {
		const option = options[ index ];
		if ( ! option ) {
			return;
		}
		setSelectedCredits( option.credits );
		optionRefs.current[ index ]?.focus();
	};
	const handleOptionKeyDown = ( event: KeyboardEvent< HTMLButtonElement >, index: number ) => {
		let nextIndex: number | undefined;
		if ( event.key === 'ArrowRight' || event.key === 'ArrowDown' ) {
			nextIndex = ( index + 1 ) % options.length;
		} else if ( event.key === 'ArrowLeft' || event.key === 'ArrowUp' ) {
			nextIndex = ( index - 1 + options.length ) % options.length;
		} else if ( event.key === 'Home' ) {
			nextIndex = 0;
		} else if ( event.key === 'End' ) {
			nextIndex = options.length - 1;
		}
		if ( nextIndex === undefined ) {
			return;
		}
		event.preventDefault();
		selectOption( nextIndex );
	};

	return (
		<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ __( 'Add AI credits' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<Dialog.Description>
						{ createInterpolateElement(
							/* translators: <strong> and </strong> emphasize that the purchase happens once. */
							__(
								'Choose a <strong>one-time</strong> AI credit amount to check out securely on WordPress.com. AI credits do not expire.'
							),
							{ strong: <strong className={ styles.descriptionEmphasis } /> }
						) }
					</Dialog.Description>
					<div
						className={ styles.amountCards }
						role="radiogroup"
						aria-label={ __( 'AI credit amount' ) }
					>
						{ options.map( ( option, index ) => (
							<button
								key={ option.credits }
								ref={ ( element ) => {
									optionRefs.current[ index ] = element;
								} }
								type="button"
								role="radio"
								aria-checked={ option.credits === selected?.credits }
								tabIndex={ option.credits === selected?.credits ? 0 : -1 }
								className={ styles.amountOption }
								data-selected={ option.credits === selected?.credits ? '' : undefined }
								onClick={ () => setSelectedCredits( option.credits ) }
								onKeyDown={ ( event ) => handleOptionKeyDown( event, index ) }
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
