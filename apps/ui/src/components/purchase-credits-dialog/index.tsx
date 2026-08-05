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
const CARD_AMOUNTS = [ 10, 20, 50, 100 ];
const PRESET_AMOUNTS = [ 25, 50, 100 ];
const creditAmountFormatter = new Intl.NumberFormat();
const { ThemeProvider } = unlock( privateApis );
type PurchaseVariant = 'cards' | 'presets' | 'slider';

export function PurchaseCreditsDialog( {
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const [ amount, setAmount ] = useState( String( DEFAULT_CREDIT_AMOUNT ) );
	const [ variant, setVariant ] = useState< PurchaseVariant >( 'slider' );
	const colorScheme = useColorScheme();
	const dialogBackground = colorScheme === 'dark' ? '#1e1e1e' : '#ffffff';
	const checkoutAmount = Number( amount );
	const hasValidAmount = Number.isInteger( checkoutAmount ) && checkoutAmount >= MIN_CREDIT_AMOUNT;
	const sliderAmount = Math.min(
		MAX_CREDIT_AMOUNT,
		Math.max( MIN_CREDIT_AMOUNT, checkoutAmount || DEFAULT_CREDIT_AMOUNT )
	);
	const isOffScale = checkoutAmount > MAX_CREDIT_AMOUNT;
	const formattedAmount = amount ? creditAmountFormatter.format( checkoutAmount ) : '';
	const formattedCheckoutAmount = creditAmountFormatter.format( checkoutAmount );
	const hasSelectedPreset = PRESET_AMOUNTS.includes( checkoutAmount );
	const updateTypedAmount = ( value: string ) => {
		const digits = value.replace( /\D/g, '' );
		setAmount( digits.replace( /^0+(?=\d)/, '' ) );
	};

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
				formattedCheckoutAmount
			),
		} );
	};

	return (
		<ThemeProvider color={ { bg: dialogBackground } }>
			<Dialog.Root open={ open } onOpenChange={ onOpenChange }>
				<Dialog.Popup className={ styles.dialogPopup } size="small" initialFocus={ false }>
					<Dialog.Header>
						<Dialog.Title>{ __( 'Add AI credits' ) }</Dialog.Title>
					</Dialog.Header>
					<Dialog.Content>
						<Dialog.Description>
							{ __(
								'Choose a one-time amount to check out securely on WordPress.com. Credits do not expire and are used after your monthly allowance.'
							) }
						</Dialog.Description>
						{ variant === 'cards' && (
							<div className={ styles.amountCards } data-layout="grid">
								{ CARD_AMOUNTS.map( ( option ) => (
									<button
										key={ option }
										type="button"
										className={ styles.amountOption }
										data-selected={ checkoutAmount === option ? '' : undefined }
										onClick={ () => setAmount( String( option ) ) }
									>
										<span className={ styles.optionValue }>${ option }</span>
										<span className={ styles.optionFrequency }>{ __( 'one time' ) }</span>
									</button>
								) ) }
							</div>
						) }
						{ variant === 'presets' && (
							<div className={ styles.presetPicker }>
								<div className={ styles.amountCards } data-layout="row">
									{ PRESET_AMOUNTS.map( ( option ) => (
										<button
											key={ option }
											type="button"
											className={ styles.amountOption }
											data-selected={ checkoutAmount === option ? '' : undefined }
											onClick={ () => setAmount( String( option ) ) }
										>
											<span className={ styles.optionValue }>${ option }</span>
											<span className={ styles.optionCreditCount }>
												{ sprintf(
													/* translators: %s: number of AI credits. */
													__( '%s credits' ),
													String( option )
												) }
											</span>
											<span className={ styles.optionFrequency }>{ __( 'one time' ) }</span>
										</button>
									) ) }
								</div>
								<label className={ styles.customAmount }>
									<span className={ styles.amountInputLabel }>{ __( 'Custom amount' ) }</span>
									<span className={ styles.amountControl }>
										<span className={ styles.customAmountPrefix } aria-hidden="true">
											$
										</span>
										<input
											className={ styles.customAmountInput }
											type="text"
											inputMode="numeric"
											placeholder={ __( 'Enter amount' ) }
											value={ hasSelectedPreset ? '' : formattedAmount }
											onChange={ ( event ) => updateTypedAmount( event.target.value ) }
										/>
										<span className={ styles.amountDetails }>
											<span className={ styles.amountLabel }>
												{ ! hasSelectedPreset && hasValidAmount
													? sprintf(
															/* translators: %s: number of AI credits. */
															__( '%s credits' ),
															formattedCheckoutAmount
													  )
													: __( 'Credits' ) }
											</span>
											<span className={ styles.amountFrequency }>{ __( 'one time' ) }</span>
										</span>
									</span>
								</label>
							</div>
						) }
						{ variant === 'slider' && (
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
										type="text"
										inputMode="numeric"
										value={ formattedAmount }
										onChange={ ( event ) => updateTypedAmount( event.target.value ) }
									/>
									<span className={ styles.amountDetails }>
										<span className={ styles.amountLabel }>
											{ hasValidAmount
												? sprintf(
														/* translators: %s: number of AI credits. */
														__( '%s credits' ),
														formattedCheckoutAmount
												  )
												: sprintf(
														/* translators: %s: minimum number of AI credits. */
														__( '%s or more credits' ),
														String( MIN_CREDIT_AMOUNT )
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
									data-overflow={ isOffScale ? '' : undefined }
								/>
								<div
									className={ styles.rangeLabels }
									data-overflow={ isOffScale ? '' : undefined }
									aria-hidden="true"
								>
									<span>${ MIN_CREDIT_AMOUNT }</span>
									<span>{ isOffScale ? __( 'Off the chart →' ) : `$${ MAX_CREDIT_AMOUNT }` }</span>
								</div>
							</div>
						) }
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
											formattedCheckoutAmount
									  )
									: __( 'Continue' ) }
							</Tooltip.Trigger>
							<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
								{ __( 'Checkout on WordPress.com' ) }
							</Tooltip.Popup>
						</Tooltip.Root>
					</Dialog.Footer>
					<div className={ styles.variantSwitcher } role="group" aria-label={ __( 'Purchase UI' ) }>
						<span className={ styles.variantLabel }>{ __( 'Purchase UI' ) }</span>
						{ (
							[
								[ 'cards', __( 'Cards' ) ],
								[ 'presets', __( 'Presets + custom' ) ],
								[ 'slider', __( 'Slider' ) ],
							] as const
						 ).map( ( [ value, label ] ) => (
							<button
								key={ value }
								type="button"
								className={ styles.variantButton }
								aria-pressed={ variant === value }
								onClick={ () => setVariant( value ) }
							>
								{ label }
							</button>
						) ) }
					</div>
				</Dialog.Popup>
			</Dialog.Root>
		</ThemeProvider>
	);
}
