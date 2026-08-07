import {
	ADD_PAYMENT_METHOD_URL,
	formatAiAccessRequiredHeadline,
	formatAiBlockedNotice,
	getStudioCodeAiAccessState,
	STUDIO_CODE_AI_BETA_APPLY_URL,
	WPCOM_SUPPORT_CONTACT_URL,
	type StudioAssistantQuota,
	type StudioCodeAiAccessState,
} from '@studio/common/lib/studio-assistant-quota';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import styles from './access-requirements.module.css';

type AccessQuota = Pick<
	StudioAssistantQuota,
	'costUsage' | 'studioCodeAiHasAccess' | 'studioCodeAiAccess'
>;

// No email-verification case: adding a payment method on WordPress.com
// already requires a verified email, so a card-holding account can't have an
// unverified address.
function getRequirementCopy( accessState: StudioCodeAiAccessState, quota: AccessQuota ) {
	if ( accessState === 'not-enabled' ) {
		return {
			title: __( 'Studio Code Beta' ),
			description: formatAiAccessRequiredHeadline( quota ),
			reassurance: null,
			button: __( 'Apply for access' ),
			url: STUDIO_CODE_AI_BETA_APPLY_URL,
			browserTitle: __( 'Finish applying for access' ),
			browserDescription: __(
				'Complete your application in your browser, then come back here. Studio will check your account again.'
			),
		};
	}
	return {
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
	};
}

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
 * Upfront gate for the agentic chat. The WordPress.com proxy denies AI
 * requests without a saved payment method (STU-2174), and for accounts
 * without semi-open beta access (STU-2146); this surfaces those requirements
 * before the first prompt instead of as an error after it. Beta access
 * outranks the payment requirement — there's no point collecting a card from
 * an account that can't get in yet. The proxy remains the enforcement point.
 */
export function AccessRequirements( {
	quota,
	isRechecking,
	onRecheck,
}: {
	quota: AccessQuota;
	isRechecking: boolean;
	onRecheck: () => void;
} ) {
	const connector = useConnector();
	const [ isWaitingForBrowser, setIsWaitingForBrowser ] = useState( false );
	const accessState = getStudioCodeAiAccessState( quota );

	if ( accessState === 'blocked' ) {
		return (
			<div className={ styles.root }>
				<Frost />
				<div className={ styles.copy }>
					<h2 className={ styles.title }>{ __( 'Studio Code Beta' ) }</h2>
					<p className={ styles.description }>
						{ createInterpolateElement( formatAiBlockedNotice(), { supportLink: <span /> } ) }
					</p>
					<div className={ styles.actions }>
						<Button
							type="button"
							variant="solid"
							className={ styles.cta }
							onClick={ () => void connector.openExternalUrl( WPCOM_SUPPORT_CONTACT_URL ) }
						>
							{ __( 'Contact support' ) }
						</Button>
						<Button
							type="button"
							variant="minimal"
							tone="neutral"
							aria-disabled={ isRechecking }
							onClick={ onRecheck }
						>
							{ isRechecking ? __( 'Checking…' ) : __( 'Check again' ) }
						</Button>
					</div>
				</div>
			</div>
		);
	}

	const copy = getRequirementCopy( accessState, quota );

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
				{ copy.reassurance && <p className={ styles.description }>{ copy.reassurance }</p> }
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
