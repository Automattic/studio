import { __ } from '@wordpress/i18n';
import { useState, type ReactNode } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { DotGrid } from 'src/components/dot-grid';
import styles from './access-requirement-prototype.module.css';
import { StudioCodeTabImage } from './studio-code-tab-image';

type Requirement = 'payment' | 'email';
type PrototypeState = Requirement | `${ Requirement }-browser` | 'eligible';

const requirementCopy = {
	payment: {
		title: __( 'Studio Code Beta' ),
		description: __(
			'To enroll in our free beta period, you must add a valid payment method to your WordPress.com account. You’ll get up to 500 free credits per month.'
		),
		button: __( 'Add payment method' ),
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

function RequirementScreen( {
	requirement,
	isWaitingForBrowser,
	onContinue,
	onComplete,
	onBack,
}: {
	requirement: Requirement;
	isWaitingForBrowser: boolean;
	onContinue: () => void;
	onComplete: () => void;
	onBack: () => void;
} ) {
	const copy = requirementCopy[ requirement ];

	if ( isWaitingForBrowser ) {
		return (
			<div className={ styles.requirementLayout }>
				<div className={ styles.centeredContent }>
					<div className={ styles.centeredCopy }>
						<div className="a8c-subtitle mb-1">{ copy.browserTitle }</div>
						<div className="w-[40ch] text-frame-text-secondary a8c-body">
							{ copy.browserDescription }
						</div>
						<div className={ styles.waitingIndicator }>{ __( 'Waiting for account update' ) }</div>
						<div className="mt-8 flex items-center gap-2">
							<Button variant="primary" onClick={ onComplete }>
								{ __( 'Check again' ) }
							</Button>
							<Button variant="tertiary" onClick={ onBack }>
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
		<div className={ styles.requirementLayout }>
			<div className={ styles.centeredContent }>
				<div className={ styles.centeredCopy }>
					<div className="a8c-subtitle mb-1">{ copy.title }</div>
					<div className="max-w-[48ch] text-frame-text-secondary a8c-body">
						<span>{ copy.description }</span>
						{ requirement === 'payment' && (
							<span className={ styles.reassuranceLine }>
								{ __( 'You won’t be charged during the beta.' ) }
							</span>
						) }
					</div>
					<div className="mt-8">
						<Button variant="primary" onClick={ onContinue }>
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

export function AccessRequirementPrototype( { children }: { children: ReactNode } ) {
	const [ state, setState ] = useState< PrototypeState >( 'payment' );
	const requirement: Requirement = state.startsWith( 'email' ) ? 'email' : 'payment';

	return (
		<div className={ styles.prototypeRoot }>
			{ state === 'eligible' ? (
				children
			) : (
				<RequirementScreen
					requirement={ requirement }
					isWaitingForBrowser={ state.endsWith( '-browser' ) }
					onContinue={ () => setState( `${ requirement }-browser` ) }
					onComplete={ () => setState( requirement === 'payment' ? 'email' : 'eligible' ) }
					onBack={ () => setState( requirement ) }
				/>
			) }
		</div>
	);
}
