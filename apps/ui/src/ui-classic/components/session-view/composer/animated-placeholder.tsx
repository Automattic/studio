import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import styles from './style.module.css';

export const PLACEHOLDER_FADE_DURATION_MS = 120;

function prefersReducedMotion() {
	return window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false;
}

export function AnimatedPlaceholder( { text }: { text: string } ) {
	const [ display, setDisplay ] = useState( text );
	const [ phase, setPhase ] = useState< 'idle' | 'out' | 'in' >( 'idle' );
	const previousTargetRef = useRef( text );

	useEffect( () => {
		const previousTarget = previousTargetRef.current;
		previousTargetRef.current = text;

		if ( previousTarget === text ) {
			return;
		}
		if ( prefersReducedMotion() ) {
			setDisplay( text );
			return;
		}

		setPhase( 'out' );
		const timeout = window.setTimeout( () => {
			setDisplay( text );
			setPhase( 'in' );
		}, PLACEHOLDER_FADE_DURATION_MS );

		return () => window.clearTimeout( timeout );
	}, [ text ] );

	return (
		<span
			className={ clsx(
				phase === 'out' && styles.placeholderFadeOut,
				phase === 'in' && styles.placeholderFadeIn
			) }
		>
			{ display }
		</span>
	);
}
