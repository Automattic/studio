import { ADD_PAYMENT_METHOD_URL } from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import styles from './access-requirements.module.css';

// No email-verification case: adding a payment method on WordPress.com
// already requires a verified email, so a card-holding account can't have an
// unverified address.
const requirementCopy = {
	title: __( 'Studio Code Beta' ),
	description: __(
		'To enroll in our free beta you must add a valid payment method to your WordPress.com account.'
	),
	reassurance: __( 'You won’t be charged during the beta.' ),
	button: __( 'Add payment method' ),
	url: ADD_PAYMENT_METHOD_URL,
	browserTitle: __( 'Finish adding your payment method' ),
	browserDescription: __(
		'Complete the setup in your browser, then come back here. Studio will check your account again.'
	),
} as const;

function Frost() {
	return (
		<>
			<span className={ clsx( styles.frost, styles.frostSoft ) } aria-hidden="true" />
			<span className={ clsx( styles.frost, styles.frostMedium ) } aria-hidden="true" />
			<span className={ clsx( styles.frost, styles.frostStrong ) } aria-hidden="true" />
			<span className={ clsx( styles.frost, styles.frostIntense ) } aria-hidden="true" />
		</>
	);
}

/**
 * Upfront gate for the agentic chat (STU-2178). The WordPress.com proxy denies
 * AI requests without a saved payment method (STU-2174); this surfaces that
 * requirement before the first prompt instead of as an error after it. The
 * proxy remains the enforcement point.
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
				<Frost />
				<div className={ styles.copy }>
					<h2 className={ styles.title }>{ copy.browserTitle }</h2>
					<p className={ styles.description }>{ copy.browserDescription }</p>
					<p className={ styles.waitingIndicator }>{ __( 'Waiting for account update' ) }</p>
					<div className={ styles.actions }>
						<Button
							type="button"
							variant="solid"
							className={ styles.cta }
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
			<Frost />
			<div className={ styles.copy }>
				<h2 className={ styles.title }>{ copy.title }</h2>
				<p className={ styles.description }>{ copy.description }</p>
				<p className={ styles.description }>{ copy.reassurance }</p>
				<div className={ styles.actions }>
					<Button
						type="button"
						variant="solid"
						className={ styles.cta }
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
