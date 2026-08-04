import { __, sprintf } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { Button, Dialog, Tooltip } from '@wordpress/ui';
import { useState } from 'react';
import { toast } from '@/data/app-messages';
import { addExplorationCredits } from '@/data/usage-exploration';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';

const CREDIT_AMOUNTS = [ 10, 20, 50, 100 ];
const { ThemeProvider } = unlock( privateApis );

export function PurchaseCreditsDialog( {
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const [ amount, setAmount ] = useState( 20 );
	const colorScheme = useColorScheme();
	const dialogBackground = colorScheme === 'dark' ? '#1e1e1e' : '#ffffff';

	const continueToCheckout = () => {
		addExplorationCredits( amount );
		onOpenChange( false );
		toast.success( __( 'Credits added' ), {
			description: sprintf(
				/* translators: %s: dollar amount of AI credits purchased. */
				__( '$%s in AI credits is now available.' ),
				String( amount )
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
								'Choose a one-time credit amount to check out securely on WordPress.com. Credits do not expire and are used after your monthly allowance.'
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
									onClick={ () => setAmount( option ) }
								>
									<span className={ styles.amountValue }>${ option }</span>
									<span className={ styles.amountLabel }>{ __( 'one time' ) }</span>
								</button>
							) ) }
						</div>
					</Dialog.Content>
					<Dialog.Footer>
						<Dialog.Action variant="minimal" tone="neutral">
							{ __( 'Cancel' ) }
						</Dialog.Action>
						<Tooltip.Root>
							<Tooltip.Trigger
								render={ <Button variant="solid" tone="brand" onClick={ continueToCheckout } /> }
							>
								{ sprintf(
									/* translators: %s: dollar amount of AI credits selected. */
									__( 'Continue with $%s' ),
									String( amount )
								) }
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
