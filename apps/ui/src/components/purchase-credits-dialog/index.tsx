import { __, sprintf } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { Button, Dialog, Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import { toast } from '@/data/app-messages';
import { addExplorationCredits } from '@/data/usage-exploration';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';

const CREDIT_AMOUNTS = [ 25, 50, 100 ];
const { ThemeProvider } = unlock( privateApis );

export function PurchaseCreditsDialog( {
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const [ amount, setAmount ] = useState< number | null >( 50 );
	const [ customAmount, setCustomAmount ] = useState( '' );
	const colorScheme = useColorScheme();
	const dialogBackground = colorScheme === 'dark' ? '#1e1e1e' : '#ffffff';
	const parsedCustomAmount = Number( customAmount );
	const checkoutAmount = amount ?? parsedCustomAmount;
	const hasValidAmount = Number.isInteger( checkoutAmount ) && checkoutAmount > 0;

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
						<div
							className={ styles.amounts }
							role="radiogroup"
							aria-label={ __( 'Credit amount' ) }
						>
							{ CREDIT_AMOUNTS.map( ( option ) => (
								<button
									key={ option }
									type="button"
									className={ styles.amount }
									data-selected={ amount === option ? '' : undefined }
									role="radio"
									aria-checked={ amount === option }
									onClick={ () => {
										setAmount( option );
										setCustomAmount( '' );
									} }
								>
									<span className={ styles.amountValue }>${ option }</span>
									<span className={ styles.amountDetails }>
										<span className={ styles.amountLabel }>
											{ sprintf(
												/* translators: %s: number of AI credits included. */
												__( '%s credits' ),
												String( option )
											) }
										</span>
										<span className={ styles.amountFrequency }>{ __( 'one time' ) }</span>
									</span>
								</button>
							) ) }
						</div>
						<label className={ styles.customAmount }>
							<span className={ styles.customAmountLabel }>{ __( 'Custom amount' ) }</span>
							<span
								className={ styles.customAmountControl }
								data-selected={ amount === null && customAmount ? '' : undefined }
							>
								<span className={ styles.customAmountPrefix } aria-hidden="true">
									$
								</span>
								<input
									className={ styles.customAmountInput }
									type="number"
									min="1"
									step="1"
									inputMode="numeric"
									placeholder={ __( 'Enter amount' ) }
									value={ customAmount }
									onChange={ ( event ) => {
										setCustomAmount( event.target.value );
										setAmount( null );
									} }
								/>
								<span className={ styles.amountDetails }>
									<span className={ styles.amountLabel }>
										{ customAmount && hasValidAmount
											? sprintf(
													/* translators: %s: custom number of AI credits. */
													__( '%s credits' ),
													String( checkoutAmount )
											  )
											: __( 'Credits' ) }
									</span>
									<span className={ styles.amountFrequency }>{ __( 'one time' ) }</span>
								</span>
							</span>
						</label>
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
