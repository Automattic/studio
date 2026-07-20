import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import styles from './style.module.css';
import type { AgenticFeatureReason } from '@/data/queries/use-agentic-features';

export function OfflineBanner() {
	const { enabled, reason } = useAgenticFeatures();
	const navigate = useNavigate();

	// Going offline forces the user out of the agent view onto settings; send
	// them back once connectivity returns. Mirrors AgenticSigninBanner's
	// signed-out → enabled transition.
	const previousReasonRef = useRef< AgenticFeatureReason >( null );
	useEffect( () => {
		const previous = previousReasonRef.current;
		previousReasonRef.current = reason;
		if ( enabled && previous === 'offline' ) {
			void navigate( { to: '/' } );
		}
	}, [ enabled, reason, navigate ] );

	if ( reason !== 'offline' ) {
		return null;
	}

	return (
		<section className={ styles.root } role="status">
			<h2 className={ styles.heading }>{ __( "You're offline" ) }</h2>
			<p className={ styles.description }>
				{ __(
					'Studio Code and sharing features need an internet connection. Your local sites still work normally.'
				) }
			</p>
		</section>
	);
}
