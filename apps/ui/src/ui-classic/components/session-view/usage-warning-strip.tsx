import { __, sprintf } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { PurchaseCreditsDialog } from '@/components/purchase-credits-dialog';
import { PURCHASE_CREDITS_PROTOTYPE_URL } from '@/components/purchase-credits-dialog/events';
import { useConnector } from '@/data/core';
import { useUsageExploration } from '@/data/usage-exploration';
import styles from './style.module.css';

export function UsageWarningStrip( { percentage }: { percentage: number } ) {
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

	return (
		<>
			<section className={ styles.usageWarningStrip } role="status">
				<span>
					{ sprintf(
						/* translators: %s: percentage of the active AI credit pool used. */
						__( 'At %s%% usage' ),
						String( percentage )
					) }
				</span>
				<Button
					className={ styles.usageWarningStripButton }
					size="small"
					variant="outline"
					tone="neutral"
					onClick={ openPurchaseCredits }
				>
					{ opensExternalCheckout ? __( 'Purchase AI credits' ) : __( 'Add AI credits' ) }
					{ opensExternalCheckout ? (
						<Icon icon={ external } size={ 12 } aria-hidden="true" />
					) : null }
				</Button>
			</section>
			<PurchaseCreditsDialog open={ purchaseOpen } onOpenChange={ setPurchaseOpen } />
		</>
	);
}
