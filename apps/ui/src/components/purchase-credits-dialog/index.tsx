import { __, sprintf } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { Button, Dialog, Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import { toast } from '@/data/app-messages';
import { addExplorationCredits } from '@/data/usage-exploration';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';

const MIN_CREDIT_AMOUNT = 10;
const MAX_CREDIT_AMOUNT = 200;
const DEFAULT_CREDIT_AMOUNT = 50;
const { ThemeProvider } = unlock( privateApis );

export function PurchaseCreditsDialog( {
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const [ amount, setAmount ] = useState( String( DEFAULT_CREDIT_AMOUNT ) );
	const colorScheme = useColorScheme();
	const dialogBackground = colorScheme === 'dark' ? '#1e1e1e' : '#ffffff';
	const checkoutAmount = Number( amount );
	const hasValidAmount =
		Number.isInteger( checkoutAmount ) &&
		checkoutAmount >= MIN_CREDIT_AMOUNT &&
		checkoutAmount <= MAX_CREDIT_AMOUNT;
	const sliderAmount = hasValidAmount
		? checkoutAmount
		: Math.min(
				MAX_CREDIT_AMOUNT,
				Math.max( MIN_CREDIT_AMOUNT, Number( amount ) || DEFAULT_CREDIT_AMOUNT )
		  );

	const continueToCheckout = () => {
		if ( ! hasValidAmount ) {
			return;
		}

		addExplorationCredits( checkoutAmount );
		onOpenChange( false );
		toast.success( __( 'Credits added' ), {
			description: sprintf(
				/* translators: %s: dollar amount of AI credits purchased. */
				__( '$%s in AI credits is now available.' ),
				String( checkoutAmount )
			),
		} );
	};

	return (
		<ThemeProvider color={ { bg: dialogBackground } }>
			<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
				<Dialog.Popup size="small" initialFocus={ false }>
					<Dialog.Header>
						<Dialog.Title>{ __( 'Add AI credits' ) }</Dialog.Title>
					</Dialog.Header>
					<Dialog.Content>
						<Dialog.Description>
							{ __(
								'Choose a one-time amount to check out securely on WordPress.com. Credits do not expire and are used after your monthly allowance.'
							) }
						</Dialog.Description>
						<div className={ styles.amountPicker }>
							<label className={ styles.amountInputLabel } htmlFor="credit-amount-input">
								{ __( 'Credit amount' ) }
							</label>
							<span className={ styles.amountControl }>
								<span className={ styles.customAmountPrefix } aria-hidden="true">
									$
								</span>
								<input
									id="credit-amount-input"
									className={ styles.amountInput }
									type="number"
									min={ MIN_CREDIT_AMOUNT }
									max={ MAX_CREDIT_AMOUNT }
									step="1"
									inputMode="numeric"
									value={ amount }
									onChange={ ( event ) => setAmount( event.target.value ) }
								/>
								<span className={ styles.amountDetails }>
									<span className={ styles.amountLabel }>
										{ hasValidAmount
											? sprintf(
													/* translators: %s: number of AI credits. */
													__( '%s credits' ),
													String( checkoutAmount )
											  )
											: sprintf(
													/* translators: 1: minimum credits, 2: maximum credits. */
													__( '%1$s–%2$s credits' ),
													String( MIN_CREDIT_AMOUNT ),
													String( MAX_CREDIT_AMOUNT )
											  ) }
									</span>
									<span className={ styles.amountFrequency }>{ __( 'one time' ) }</span>
								</span>
							</span>
							<input
								className={ styles.amountRange }
								type="range"
								min={ MIN_CREDIT_AMOUNT }
								max={ MAX_CREDIT_AMOUNT }
								step="1"
								value={ sliderAmount }
								onChange={ ( event ) => setAmount( event.target.value ) }
								aria-label={ __( 'Credit amount slider' ) }
							/>
							<div className={ styles.rangeLabels } aria-hidden="true">
								<span>${ MIN_CREDIT_AMOUNT }</span>
								<span>${ MAX_CREDIT_AMOUNT }</span>
							</div>
						</div>
					</Dialog.Content>
					<Dialog.Footer>
						<Dialog.Action variant="minimal" tone="neutral">
							{ __( 'Cancel' ) }
						</Dialog.Action>
						<Tooltip.Root>
							<Tooltip.Trigger
								render={
									<Button
										variant="solid"
										tone="brand"
										disabled={ ! hasValidAmount }
										onClick={ continueToCheckout }
									/>
								}
							>
								{ hasValidAmount
									? sprintf(
											/* translators: %s: dollar amount of AI credits selected. */
											__( 'Continue with $%s' ),
											String( checkoutAmount )
									  )
									: __( 'Continue' ) }
							</Tooltip.Trigger>
							<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
								{ __( 'Checkout on WordPress.com' ) }
							</Tooltip.Popup>
						</Tooltip.Root>
					</Dialog.Footer>
				</Dialog.Popup>
			</Dialog.Root>
		</ThemeProvider>
	);
}
