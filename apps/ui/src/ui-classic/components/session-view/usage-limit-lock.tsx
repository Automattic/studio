import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { PurchaseCreditsDialog } from '@/components/purchase-credits-dialog';
import styles from './style.module.css';

export function UsageLimitLock( { usingExtraCredits = false }: { usingExtraCredits?: boolean } ) {
	const [ purchaseOpen, setPurchaseOpen ] = useState( false );
	const title = usingExtraCredits ? __( 'Extra AI credits used' ) : __( 'Monthly credits used' );
	const description = usingExtraCredits
		? __(
				"You've used all of your extra AI credits. Add more to keep chatting, or wait until your monthly allowance resets on Sep 3."
		  )
		: __(
				"You've used up your free $50 for the month. You'll get more credits on Sep 3. Or you can purchase more to keep chatting."
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
					onClick={ () => setPurchaseOpen( true ) }
				>
					{ __( 'Add credits' ) }
				</Button>
			</section>
			<PurchaseCreditsDialog open={ purchaseOpen } onOpenChange={ setPurchaseOpen } />
		</>
	);
}
