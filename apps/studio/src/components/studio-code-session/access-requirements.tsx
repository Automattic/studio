import { ADD_PAYMENT_METHOD_URL } from '@studio/common/lib/studio-assistant-quota';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { DotGrid } from 'src/components/dot-grid';
import { getIpcApi } from 'src/lib/get-ipc-api';
import styles from './access-requirements.module.css';
import { StudioCodeTabImage } from './studio-code-tab-image';

export type AccessRequirement = 'payment' | 'email';

const VERIFY_EMAIL_URL = 'https://wordpress.com/me/account';

const requirementCopy = {
	payment: {
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

function IllustrationRail() {
	return (
		<div className={ styles.illustrationRail } aria-hidden="true">
			<DotGrid className={ styles.railGrid } />
			<div className={ styles.railMessages }>
				<StudioCodeTabImage />
			</div>
		</div>
	);
}

/**
 * Upfront gate for the Studio Code tab (STU-2178). The WordPress.com proxy
 * denies AI requests without a saved payment method or a verified email
 * (STU-2174); this surfaces that requirement before the first prompt instead
 * of as an error after it. The proxy remains the enforcement point.
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
	const [ isWaitingForBrowser, setIsWaitingForBrowser ] = useState( false );
	const copy = requirementCopy[ requirement ];

	if ( isWaitingForBrowser ) {
		return (
			<div className={ styles.root }>
				<div className={ styles.centeredContent }>
					<div className={ styles.centeredCopy }>
						<div className="a8c-subtitle mb-1">{ copy.browserTitle }</div>
						<div className="w-[40ch] text-frame-text-secondary a8c-body">
							{ copy.browserDescription }
						</div>
						<div className={ styles.waitingIndicator }>{ __( 'Waiting for account update' ) }</div>
						<div className="mt-8 flex items-center gap-2">
							<Button variant="primary" aria-disabled={ isRechecking } onClick={ onRecheck }>
								{ isRechecking ? __( 'Checking…' ) : __( 'Check again' ) }
							</Button>
							<Button variant="tertiary" onClick={ () => setIsWaitingForBrowser( false ) }>
								{ __( 'Back' ) }
							</Button>
						</div>
					</div>
				</div>
				<IllustrationRail />
			</div>
		);
	}

	return (
		<div className={ styles.root }>
			<div className={ styles.centeredContent }>
				<div className={ styles.centeredCopy }>
					<div className="a8c-subtitle mb-1">{ copy.title }</div>
					<div className="max-w-[48ch] text-frame-text-secondary a8c-body">
						<span>{ copy.description }</span>
						{ requirement === 'payment' && (
							<span className={ styles.reassuranceLine }>
								{ __( 'During the beta, you’ll get free credits and won’t be charged.' ) }
							</span>
						) }
					</div>
					<div className="mt-8">
						<Button
							variant="primary"
							onClick={ () => {
								void getIpcApi().openURL( copy.url );
								setIsWaitingForBrowser( true );
							} }
						>
							{ copy.button }
							<ArrowIcon />
						</Button>
					</div>
				</div>
			</div>
			<IllustrationRail />
		</div>
	);
}
