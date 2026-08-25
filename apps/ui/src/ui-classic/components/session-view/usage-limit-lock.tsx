import { __ } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { AiCreditsDetailsDialog } from '@/components/ai-credits-details-dialog';
import { PurchaseCreditsDialog } from '@/components/purchase-credits-dialog';
import { PURCHASE_CREDITS_PROTOTYPE_URL } from '@/components/purchase-credits-dialog/events';
import { useConnector } from '@/data/core';
import { useUsageExploration } from '@/data/usage-exploration';
import styles from './style.module.css';

export function UsageLimitLock() {
	const [ purchaseOpen, setPurchaseOpen ] = useState( false );
	const [ detailsOpen, setDetailsOpen ] = useState( false );
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
	const title = __( 'No AI credits available' );
	const description = __( "You've used your available AI credits. Add more to keep chatting." );

	return (
		<>
			<section className={ styles.usageLimitLock } role="alert">
				<div className={ styles.usageLimitLockText }>
					<strong>{ title }</strong>
					<span>{ description }</span>
				</div>
				<div className={ styles.usageLimitLockActions }>
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
					<Button
						className={ styles.usageLimitLockButton }
						size="small"
						variant="minimal"
						tone="neutral"
						onClick={ () => setDetailsOpen( true ) }
					>
						{ __( 'Learn more' ) }
					</Button>
				</div>
			</section>
			<PurchaseCreditsDialog open={ purchaseOpen } onOpenChange={ setPurchaseOpen } />
			<AiCreditsDetailsDialog open={ detailsOpen } onOpenChange={ setDetailsOpen } />
		</>
	);
}
