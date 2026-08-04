import { ADD_PAYMENT_METHOD_URL } from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import styles from './access-requirements.module.css';

export type AccessRequirement = 'payment' | 'email';

const VERIFY_EMAIL_URL = 'https://wordpress.com/me/account';

const requirementCopy = {
	payment: {
		title: __( 'Studio Code Beta' ),
		description: __(
			'To enroll in our free beta period, you must add a valid payment method to your WordPress.com account. You’ll get up to 500 free credits per month.'
		),
		button: __( 'Add payment method' ),
		url: ADD_PAYMENT_METHOD_URL,
		browserTitle: __( 'Finish adding your payment method' ),
		browserDescription: __(
			'Complete the setup in your browser, then come back here. Studio will check your account again.'
		),
	},
	email: {
		title: __( 'Verify your email' ),
		description: __(
			'Verify your WordPress.com email address to start building with Studio Code.'
		),
		button: __( 'Verify email' ),
		url: VERIFY_EMAIL_URL,
		browserTitle: __( 'Finish verifying your email' ),
		browserDescription: __(
			'Use the link in your verification email, then come back here. Studio will check your account again.'
		),
	},
} as const;

/**
 * Upfront gate for the agentic chat (STU-2178). The WordPress.com proxy denies
 * AI requests without a saved payment method or a verified email (STU-2174);
 * this surfaces that requirement before the first prompt instead of as an
 * error after it. The proxy remains the enforcement point.
 */
export function AccessRequirements( {
	requirement,
	isRechecking,
	onRecheck,
}: {
	requirement: AccessRequirement;
	isRechecking: boolean;
	onRecheck: () => void;
} ) {
	const connector = useConnector();
	const [ isWaitingForBrowser, setIsWaitingForBrowser ] = useState( false );
	const copy = requirementCopy[ requirement ];

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
					{ requirement === 'payment' && (
						<span className={ styles.reassuranceLine }>
							{ __( 'You won’t be charged during the beta.' ) }
						</span>
					) }
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
