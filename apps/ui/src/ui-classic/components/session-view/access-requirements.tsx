import { ADD_PAYMENT_METHOD_URL } from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import styles from './access-requirements.module.css';

// No email-verification case: adding a payment method on WordPress.com
// already requires a verified email, so a card-holding account can't have an
// unverified address.
const requirementCopy = {
	title: __( 'Studio Code Beta' ),
	description: __(
		'To enroll in our free beta period, you must add a valid payment method to your WordPress.com account.'
	),
	button: __( 'Add payment method' ),
	url: ADD_PAYMENT_METHOD_URL,
	browserTitle: __( 'Finish adding your payment method' ),
	browserDescription: __(
		'Complete the setup in your browser, then come back here. Studio will check your account again.'
	),
} as const;

/**
 * Upfront gate for the agentic chat (STU-2178). The WordPress.com proxy denies
 * AI requests without a saved payment method or a verified email (STU-2174);
 * this surfaces that requirement before the first prompt instead of as an
 * error after it. The proxy remains the enforcement point.
 */
export function AccessRequirements( {
	isRechecking,
	onRecheck,
}: {
	isRechecking: boolean;
	onRecheck: () => void;
} ) {
	const connector = useConnector();
	const [ isWaitingForBrowser, setIsWaitingForBrowser ] = useState( false );
	const copy = requirementCopy;

	if ( isWaitingForBrowser ) {
		return (
			<div className={ styles.root }>
				<div className={ styles.copy }>
					<h2 className={ styles.title }>{ copy.browserTitle }</h2>
					<p className={ styles.description }>{ copy.browserDescription }</p>
					<p className={ styles.waitingIndicator }>{ __( 'Waiting for account update' ) }</p>
					<div className={ styles.actions }>
						<Button
							type="button"
							variant="solid"
							aria-disabled={ isRechecking }
							onClick={ onRecheck }
						>
							{ isRechecking ? __( 'Checking…' ) : __( 'Check again' ) }
						</Button>
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							onClick={ () => setIsWaitingForBrowser( false ) }
						>
							{ __( 'Back' ) }
						</Button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className={ styles.root }>
			<div className={ styles.copy }>
				<h2 className={ styles.title }>{ copy.title }</h2>
				<p className={ styles.description }>
					{ copy.description }
					<span className={ styles.reassuranceLine }>
						{ __( 'During the beta, you’ll get free credits and won’t be charged.' ) }
					</span>
				</p>
				<div className={ styles.actions }>
					<Button
						type="button"
						variant="solid"
						onClick={ () => {
							void connector.openExternalUrl( copy.url );
							setIsWaitingForBrowser( true );
						} }
					>
						{ copy.button }
					</Button>
				</div>
			</div>
		</div>
	);
}
