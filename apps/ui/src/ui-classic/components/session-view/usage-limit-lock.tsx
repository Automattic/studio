import { __ } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { PurchaseCreditsDialog } from '@/components/purchase-credits-dialog';
import { PURCHASE_CREDITS_PROTOTYPE_URL } from '@/components/purchase-credits-dialog/events';
import { useConnector } from '@/data/core';
import { useUsageExploration } from '@/data/usage-exploration';
import styles from './style.module.css';

export function UsageLimitLock( { usingExtraCredits = false }: { usingExtraCredits?: boolean } ) {
	const [ purchaseOpen, setPurchaseOpen ] = useState( false );
	const connector = useConnector();
	const { purchaseCreditsFlow } = useUsageExploration();
	const opensExternalCheckout = purchaseCreditsFlow === 'external';
	const openPurchaseCredits = () => {
		if ( opensExternalCheckout ) {
			void connector.openExternalUrl( PURCHASE_CREDITS_PROTOTYPE_URL );
			return;
		}
		setPurchaseOpen( true );
	};
	const title = usingExtraCredits
		? __( 'Purchased AI credits used' )
		: __( 'Monthly AI credits used' );
	const description = usingExtraCredits
		? __(
				"You've used all of your purchased AI credits. Add more to keep chatting, or wait until your monthly allowance resets on Sep 3."
		  )
		: __(
				"You've used your monthly AI credit allowance. You'll get more AI credits on Sep 3, or you can add more to keep chatting."
		  );

	return (
		<>
			<section className={ styles.usageLimitLock } role="alert">
				<div className={ styles.usageLimitLockText }>
					<strong>{ title }</strong>
					<span>{ description }</span>
				</div>
				<Button
					className={ styles.usageLimitLockButton }
					size="small"
					variant="solid"
					tone="brand"
					onClick={ openPurchaseCredits }
				>
					{ opensExternalCheckout ? __( 'Purchase AI credits' ) : __( 'Add AI credits' ) }
					{ opensExternalCheckout ? (
						<Icon icon={ external } size={ 14 } aria-hidden="true" />
					) : null }
				</Button>
			</section>
			<PurchaseCreditsDialog open={ purchaseOpen } onOpenChange={ setPurchaseOpen } />
		</>
	);
}
