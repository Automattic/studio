import { __, sprintf } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { Button, Dialog, Tooltip } from '@wordpress/ui';
import { useMemo, useState } from 'react';
import { toast } from '@/data/app-messages';
import {
	addExplorationCredits,
	CREDITS_PER_DOLLAR,
	creditsFromDollars,
	dollarsFromCredits,
	useUsageExploration,
} from '@/data/usage-exploration';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';
import type { CSSProperties } from 'react';

const MIN_CREDIT_AMOUNT = creditsFromDollars( 10 );
const MAX_CREDIT_AMOUNT = creditsFromDollars( 200 );
const MAX_TYPED_CREDIT_AMOUNT = creditsFromDollars( 99_999 );
const DEFAULT_CREDIT_AMOUNT = creditsFromDollars( 50 );
const CARD_AMOUNTS = [ 10, 20, 50, 100 ].map( creditsFromDollars );
const PRESET_AMOUNTS = [ 25, 50, 100 ].map( creditsFromDollars );
const CONFETTI_COLORS = [
	'var(--wpds-color-fg-interactive-brand)',
	'var(--wpds-color-fg-content-success)',
	'var(--wpds-color-fg-content-warning)',
	'var(--wpds-color-fg-content-error)',
];
const creditAmountFormatter = new Intl.NumberFormat();
const priceFormatter = new Intl.NumberFormat( undefined, {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 0,
	maximumFractionDigits: 2,
} );
const { ThemeProvider } = unlock( privateApis );
function jitter( index: number, salt: number ): number {
	const value = Math.sin( index * 127.1 + salt * 311.7 ) * 43758.5453;
	return value - Math.floor( value );
}

function ConfettiBurst() {
	const pieces = useMemo(
		() =>
			Array.from( { length: 22 }, ( _, index ) => ( {
				angle: index * ( 360 / 22 ) + ( jitter( index, 1 ) * 24 - 12 ),
				distance: 52 + jitter( index, 2 ) * 48,
				spin: jitter( index, 3 ) * 540 - 270,
				delay: jitter( index, 4 ) * 120,
				color: CONFETTI_COLORS[ index % CONFETTI_COLORS.length ],
				width: 4 + jitter( index, 5 ) * 3,
				height: 6 + jitter( index, 6 ) * 4,
			} ) ),
		[]
	);

	return (
		<div className={ styles.confetti } aria-hidden="true">
			{ pieces.map( ( piece, index ) => (
				<span
					key={ index }
					className={ styles.confettiPiece }
					style={
						{
							'--confetti-angle': `${ piece.angle }deg`,
							'--confetti-distance': `${ piece.distance }px`,
							'--confetti-spin': `${ piece.spin }deg`,
							backgroundColor: piece.color,
							width: `${ piece.width }px`,
							height: `${ piece.height }px`,
							animationDelay: `${ piece.delay }ms`,
						} as CSSProperties
					}
				/>
			) ) }
		</div>
	);
}

export function PurchaseCreditsDialog( {
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const [ amount, setAmount ] = useState( String( DEFAULT_CREDIT_AMOUNT ) );
	const [ confettiKey, setConfettiKey ] = useState( 0 );
	const { purchaseCreditsVariant: variant } = useUsageExploration();
	const colorScheme = useColorScheme();
	const dialogBackground = colorScheme === 'dark' ? '#1e1e1e' : '#ffffff';
	const checkoutAmount = Number( amount );
	const checkoutPrice = dollarsFromCredits( checkoutAmount );
	const hasValidAmount =
		Number.isInteger( checkoutAmount ) &&
		checkoutAmount >= MIN_CREDIT_AMOUNT &&
		checkoutAmount <= MAX_TYPED_CREDIT_AMOUNT;
	const sliderAmount = Math.min(
		MAX_CREDIT_AMOUNT,
		Math.max( MIN_CREDIT_AMOUNT, checkoutAmount || DEFAULT_CREDIT_AMOUNT )
	);
	const isOffScale = checkoutAmount > MAX_CREDIT_AMOUNT;
	const formattedAmount = amount ? creditAmountFormatter.format( checkoutAmount ) : '';
	const formattedCreditCount = creditAmountFormatter.format( checkoutAmount );
	const formattedCheckoutPrice = priceFormatter.format( checkoutPrice );
	const hasSelectedPreset = PRESET_AMOUNTS.includes( checkoutAmount );
	const moveCaretToEnd = ( input: HTMLInputElement ) => {
		const end = input.value.length;
		input.setSelectionRange( end, end );
	};
	const updateTypedAmount = ( value: string ) => {
		const digits = value.replace( /\D/g, '' );
		const normalizedAmount = digits.replace( /^0+(?=\d)/, '' );
		const nextAmount =
			normalizedAmount.length > String( MAX_TYPED_CREDIT_AMOUNT ).length
				? String( MAX_TYPED_CREDIT_AMOUNT )
				: normalizedAmount;

		if (
			variant === 'slider' &&
			Number( nextAmount ) > MAX_CREDIT_AMOUNT &&
			nextAmount !== amount
		) {
			setConfettiKey( ( key ) => key + 1 );
		}

		setAmount( nextAmount );
	};

	const continueToCheckout = () => {
		if ( ! hasValidAmount ) {
			return;
		}

		addExplorationCredits( checkoutPrice );
		onOpenChange( false );
		toast.success(
			sprintf(
				/* translators: %s: number of AI credits purchased. */
				__( '%s AI credits added' ),
				formattedCreditCount
			)
		);
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
								'Choose a one-time AI credit amount to check out securely on WordPress.com. AI credits do not expire.'
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
										aria-pressed={ checkoutAmount === option }
										onClick={ () => setAmount( String( option ) ) }
									>
										<span className={ styles.optionValue }>
											{ priceFormatter.format( dollarsFromCredits( option ) ) }
										</span>
										<span className={ styles.optionCreditCount }>
											{ sprintf(
												/* translators: %s: number of credits. */
												__( '%s credits' ),
												creditAmountFormatter.format( option )
											) }
										</span>
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
											aria-pressed={ checkoutAmount === option }
											onClick={ () => setAmount( String( option ) ) }
										>
											<span className={ styles.optionValue }>
												{ sprintf(
													/* translators: %s: number of AI credits. */
													__( '%s AI credits' ),
													creditAmountFormatter.format( option )
												) }
											</span>
											<span className={ styles.optionFrequency }>
												{ sprintf(
													/* translators: %s: one-time price for AI credits. */
													__( '%s one time' ),
													priceFormatter.format( dollarsFromCredits( option ) )
												) }
											</span>
										</button>
									) ) }
								</div>
								<label className={ styles.customAmount }>
									<span className={ styles.amountInputLabel }>{ __( 'Custom AI credits' ) }</span>
									<span className={ styles.amountControl }>
										<input
											className={ styles.customAmountInput }
											type="text"
											inputMode="numeric"
											placeholder={ __( 'Enter AI credits' ) }
											value={ hasSelectedPreset ? '' : formattedAmount }
											onChange={ ( event ) => updateTypedAmount( event.target.value ) }
											onFocus={ ( event ) => moveCaretToEnd( event.currentTarget ) }
											onMouseUp={ ( event ) => {
												event.preventDefault();
												moveCaretToEnd( event.currentTarget );
											} }
										/>
										<span className={ styles.amountDetails }>
											<span className={ styles.amountLabel }>
												{ ! hasSelectedPreset && hasValidAmount
													? formattedCheckoutPrice
													: __( 'Price' ) }
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
									{ __( 'AI credit amount' ) }
								</label>
								<span className={ styles.amountControl }>
									{ confettiKey > 0 && <ConfettiBurst key={ confettiKey } /> }
									<input
										id="credit-amount-input"
										className={ styles.amountInput }
										type="text"
										inputMode="numeric"
										value={ formattedAmount }
										onChange={ ( event ) => updateTypedAmount( event.target.value ) }
										onFocus={ ( event ) => moveCaretToEnd( event.currentTarget ) }
										onMouseUp={ ( event ) => {
											event.preventDefault();
											moveCaretToEnd( event.currentTarget );
										} }
									/>
									<span className={ styles.amountDetails }>
										<span className={ styles.amountLabel }>
											{ hasValidAmount
												? formattedCheckoutPrice
												: sprintf(
														/* translators: %s: minimum number of AI credits. */
														__( '%s or more AI credits' ),
														creditAmountFormatter.format( MIN_CREDIT_AMOUNT )
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
									step={ CREDITS_PER_DOLLAR }
									value={ sliderAmount }
									onChange={ ( event ) => setAmount( event.target.value ) }
									aria-label={ __( 'AI credit amount slider' ) }
									data-overflow={ isOffScale ? '' : undefined }
								/>
								<div
									className={ styles.rangeLabels }
									data-overflow={ isOffScale ? '' : undefined }
									aria-hidden="true"
								>
									<span>{ creditAmountFormatter.format( MIN_CREDIT_AMOUNT ) }</span>
									<span>
										{ isOffScale
											? __( 'Off the chart →' )
											: creditAmountFormatter.format( MAX_CREDIT_AMOUNT ) }
									</span>
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
											/* translators: %s: price for the selected AI credits. */
											__( 'Continue for %s' ),
											formattedCheckoutPrice
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
