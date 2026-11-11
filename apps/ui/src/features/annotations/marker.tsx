import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/lib/hooks';
import styles from './style.module.css';
import { useAnnotationFeedback } from './use-annotation-feedback';
import type { CSSProperties } from 'react';

/**
 * A note's number on the part it is about. The view that draws it places it
 * with `className` or `style`.
 */
export function AnnotationMarker( {
	number,
	active = true,
	blockedNavigation,
	editing = false,
	className,
	style,
}: {
	number: number;
	active?: boolean;
	blockedNavigation?: number;
	editing?: boolean;
	className?: string;
	style?: CSSProperties;
} ) {
	const feedback = useAnnotationFeedback( blockedNavigation, active && editing );
	const markerRef = useRef< HTMLSpanElement >( null );
	const reducedMotion = useReducedMotion();
	useEffect( () => {
		if ( feedback !== 'shake' || reducedMotion ) return;
		const bounce = markerRef.current?.animate?.(
			[
				{ scale: 1, offset: 0 },
				{ scale: 0.94, offset: 0.25 },
				{ scale: 1.06, offset: 0.65 },
				{ scale: 1, offset: 1 },
			],
			{ duration: 220, easing: 'ease-out' }
		);
		return () => bounce?.cancel();
	}, [ feedback, blockedNavigation, reducedMotion ] );
	const [ present, setPresent ] = useState( active );
	useEffect( () => {
		if ( active ) {
			setPresent( true );
			return;
		}
		if ( ! present ) return;
		const timer = window.setTimeout( () => setPresent( false ), 200 );
		return () => window.clearTimeout( timer );
	}, [ active, present ] );
	if ( ! present ) return null;
	return (
		<span
			ref={ markerRef }
			className={ clsx( styles.marker, className ) }
			style={ style }
			data-active={ active }
			data-feedback={ feedback ?? undefined }
			aria-hidden="true"
			onAnimationEnd={ () => {
				if ( ! active ) setPresent( false );
			} }
		>
			{ number }
		</span>
	);
}
