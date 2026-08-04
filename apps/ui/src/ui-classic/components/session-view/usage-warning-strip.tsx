import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { PurchaseCreditsDialog } from '@/components/purchase-credits-dialog';
import styles from './style.module.css';

export function UsageWarningStrip( {
	percentage,
	usingExtraCredits = false,
}: {
	percentage: number;
	usingExtraCredits?: boolean;
} ) {
	const [ purchaseOpen, setPurchaseOpen ] = useState( false );

	return (
		<>
			<section className={ styles.usageWarningStrip } role="status">
				<span>
					{ sprintf(
						/* translators: %s: percentage of the active AI credit pool used. */
						usingExtraCredits ? __( 'At %s%% extra credit usage' ) : __( 'At %s%% usage' ),
						String( percentage )
					) }
				</span>
				<Button
					className={ styles.usageWarningStripButton }
					size="small"
					variant="outline"
					tone="neutral"
					onClick={ () => setPurchaseOpen( true ) }
				>
					{ __( 'Add credits' ) }
				</Button>
			</section>
			<PurchaseCreditsDialog open={ purchaseOpen } onOpenChange={ setPurchaseOpen } />
		</>
	);
}
