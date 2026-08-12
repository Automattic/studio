import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';
import { useEffect, useRef } from 'react';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import styles from './style.module.css';
import type { AgenticFeatureReason } from '@/data/queries/use-agentic-features';

export function AgenticSigninBanner() {
	const { enabled, reason } = useAgenticFeatures();
	const navigate = useNavigate();

	// `authenticate()` resolves when the browser opens, not when OAuth
	// completes, so a finished login only surfaces here as a signed-out →
	// enabled transition. Send the user back to the chat screen when it does.
	const previousReasonRef = useRef< AgenticFeatureReason >( null );
	useEffect( () => {
		const previous = previousReasonRef.current;
		previousReasonRef.current = reason;
		if ( enabled && previous === 'signed-out' ) {
			void navigate( { to: '/' } );
		}
	}, [ enabled, reason, navigate ] );

	if ( reason !== 'signed-out' ) {
		return null;
	}

	return <SigninNotice />;
}

// The banner without the route-aware behaviour, for surfaces that must stay
// put once the user signs in (e.g. Settings).
export function SigninNotice() {
	const login = useLogin();

	return (
		<section className={ styles.root } aria-label={ __( 'Sign in to Studio' ) }>
			<div className={ styles.text }>
				<h2 className={ styles.heading }>{ __( 'Sign in to do more with Studio' ) }</h2>
				<ul className={ styles.benefits }>
					<li>
						{ __( 'Collaborate with an AI-powered expert that can help build and edit your site' ) }
					</li>
					<li>{ __( 'Share your work instantly with preview links' ) }</li>
					<li>{ __( "Publish to a real WordPress.com site when you're ready" ) }</li>
				</ul>
			</div>
			<div className={ styles.actions }>
				<Button
					type="button"
					variant="solid"
					tone="brand"
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					{ __( 'Log in with WordPress.com' ) }
				</Button>
			</div>
		</section>
	);
}
