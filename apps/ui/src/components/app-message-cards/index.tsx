import { __ } from '@wordpress/i18n';
import { Button, Notice } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import toastStyles from '@/components/app-toasts/style.module.css';
import { PurchaseCreditsDialog } from '@/components/purchase-credits-dialog';
import { OPEN_PURCHASE_CREDITS_EVENT } from '@/components/purchase-credits-dialog/events';
import { useActivePersistentMessages } from '@/data/queries/use-app-messages';
import styles from './style.module.css';

export function AppMessageCards( { className }: { className?: string } ) {
	const { messages, dismiss } = useActivePersistentMessages();
	const [ purchaseOpen, setPurchaseOpen ] = useState( false );

	useEffect( () => {
		const openPurchase = () => setPurchaseOpen( true );
		window.addEventListener( OPEN_PURCHASE_CREDITS_EVENT, openPurchase );
		return () => window.removeEventListener( OPEN_PURCHASE_CREDITS_EVENT, openPurchase );
	}, [] );

	return (
		<>
			{ messages.length ? (
				<div className={ clsx( styles.stack, className ) }>
					{ messages.map( ( message ) => (
						<div key={ message.id } className={ styles.cell }>
							<Notice.Root
								intent={ message.intent }
								icon={ null }
								className={ clsx( toastStyles.notice, styles.card ) }
							>
								<Notice.Title>{ message.title }</Notice.Title>
								{ message.description ? (
									<Notice.Description>{ message.description }</Notice.Description>
								) : null }
								{ message.cta ? (
									<Notice.Actions>
										<Button
											size="small"
											variant="solid"
											tone="neutral"
											className={ toastStyles.actionButton }
											onClick={ message.cta.onClick }
										>
											{ message.cta.label }
										</Button>
									</Notice.Actions>
								) : null }
								<Notice.CloseIcon label={ __( 'Dismiss' ) } onClick={ () => dismiss( message ) } />
							</Notice.Root>
						</div>
					) ) }
				</div>
			) : null }
			<PurchaseCreditsDialog open={ purchaseOpen } onOpenChange={ setPurchaseOpen } />
		</>
	);
}

export function AppMessageCardsDot( { className }: { className?: string } ) {
	const { messages } = useActivePersistentMessages();

	if ( ! messages.length ) {
		return null;
	}

	return <span className={ clsx( styles.dot, className ) } aria-hidden="true" />;
}
