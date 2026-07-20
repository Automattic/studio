import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import styles from './style.module.css';
import type { ComposerPlaceholderEffect } from '@/lib/composer-placeholder-effect';

const TYPE_BACKSPACE_MS = 14;
const TYPE_PAUSE_MS = 140;
const TYPE_KEYSTROKE_MS = 30;
const TYPE_REST_MS = 2200;

const WAVE_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const WAVE_SWEEP_MS = 900;
const WAVE_WINDOW = 3;
const WAVE_TICK_MS = 70;

// Must match the fade-out animation duration (--wpds-motion-duration-md).
const FADE_OUT_MS = 200;

const FLAP_STAGGER_MS = 26;
// Swap the character at the animation's midpoint, while the flap is edge-on.
const FLAP_SWAP_MS = 180;
const FLAP_DURATION_MS = 360;

function prefersReducedMotion() {
	return window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false;
}

/**
 * Renders the composer placeholder, transitioning between suggestions with
 * the user's chosen effect (see `useComposerPlaceholderEffect`). Every effect
 * snaps under `prefers-reduced-motion`.
 */
export function AnimatedPlaceholder( {
	text,
	effect,
}: {
	text: string;
	effect: ComposerPlaceholderEffect;
} ) {
	switch ( effect ) {
		case 'wave':
			return <WavePlaceholder text={ text } />;
		case 'flap':
			return <FlapPlaceholder text={ text } />;
		case 'fade':
			return <FadePlaceholder text={ text } />;
		case 'none':
			return <>{ text }</>;
		case 'type':
		default:
			return <TypePlaceholder text={ text } />;
	}
}

/**
 * Terminal type-out: the old suggestion backspaces away, the new one types in
 * behind a block cursor that blinks briefly and then rests.
 */
function TypePlaceholder( { text }: { text: string } ) {
	const [ display, setDisplay ] = useState( text );
	const [ cursor, setCursor ] = useState< 'hidden' | 'solid' | 'blink' >( 'hidden' );
	const displayRef = useRef( text );
	const previousTargetRef = useRef( text );

	useEffect( () => {
		const previousTarget = previousTargetRef.current;
		previousTargetRef.current = text;

		if ( previousTarget === text ) {
			return;
		}
		if ( prefersReducedMotion() ) {
			displayRef.current = text;
			setDisplay( text );
			return;
		}

		let timeout = 0;
		const show = ( next: string ) => {
			displayRef.current = next;
			setDisplay( next );
		};
		setCursor( 'solid' );

		const backspace = () => {
			if ( displayRef.current.length === 0 ) {
				timeout = window.setTimeout( typeNext, TYPE_PAUSE_MS );
				return;
			}
			show( displayRef.current.slice( 0, -1 ) );
			timeout = window.setTimeout( backspace, TYPE_BACKSPACE_MS );
		};

		let index = 0;
		const typeNext = () => {
			if ( index >= text.length ) {
				setCursor( 'blink' );
				timeout = window.setTimeout( () => setCursor( 'hidden' ), TYPE_REST_MS );
				return;
			}
			show( displayRef.current + text.charAt( index ) );
			index += 1;
			// A touch of drift so the rhythm reads as typed, not metronomic.
			timeout = window.setTimeout( typeNext, TYPE_KEYSTROKE_MS + Math.sin( index * 1.7 ) * 10 );
		};

		backspace();

		return () => window.clearTimeout( timeout );
	}, [ text ] );

	return (
		<>
			{ display }
			{ cursor !== 'hidden' ? (
				<span
					className={ clsx(
						styles.placeholderCursor,
						cursor === 'blink' && styles.placeholderCursorBlink
					) }
				/>
			) : null }
		</>
	);
}

/**
 * Decode wave: a narrow scramble window sweeps left to right, resolving the
 * old suggestion into the new one. Letters only, so most of the string stays
 * readable throughout.
 */
function WavePlaceholder( { text }: { text: string } ) {
	const [ display, setDisplay ] = useState( text );
	const previousTargetRef = useRef( text );

	useEffect( () => {
		const previousTarget = previousTargetRef.current;
		previousTargetRef.current = text;

		if ( previousTarget === text || prefersReducedMotion() ) {
			setDisplay( text );
			return;
		}

		const maxLength = Math.max( previousTarget.length, text.length );
		const perCharacterMs = WAVE_SWEEP_MS / maxLength;
		const startTime = performance.now();
		let animationFrame = 0;

		const renderFrame = ( now: number ) => {
			const elapsed = now - startTime;
			const front = elapsed / perCharacterMs;
			let nextText = '';
			let isComplete = true;

			for ( let index = 0; index < maxLength; index++ ) {
				if ( index > front ) {
					nextText += previousTarget.charAt( index );
					isComplete = false;
					continue;
				}
				if ( index < front - WAVE_WINDOW ) {
					nextText += text.charAt( index );
					continue;
				}
				isComplete = false;
				const previousCharacter = previousTarget.charAt( index );
				const targetCharacter = text.charAt( index );
				nextText +=
					previousCharacter === ' ' || targetCharacter === ' '
						? targetCharacter || ' '
						: WAVE_CHARS.charAt(
								( index * 5 + Math.floor( elapsed / WAVE_TICK_MS ) ) % WAVE_CHARS.length
						  );
			}

			if ( isComplete ) {
				setDisplay( text );
				return;
			}
			setDisplay( nextText.trimEnd() );
			animationFrame = window.requestAnimationFrame( renderFrame );
		};

		animationFrame = window.requestAnimationFrame( renderFrame );

		return () => window.cancelAnimationFrame( animationFrame );
	}, [ text ] );

	return <>{ display }</>;
}

/**
 * Split-flap board: each changed character does one vertical flip, cascading
 * left to right, and swaps to its target character at the flip's midpoint.
 */
function FlapPlaceholder( { text }: { text: string } ) {
	const [ transition, setTransition ] = useState< { from: string; to: string } | null >( null );
	const [ elapsed, setElapsed ] = useState( 0 );
	const previousTargetRef = useRef( text );

	useEffect( () => {
		const previousTarget = previousTargetRef.current;
		previousTargetRef.current = text;

		if ( previousTarget === text || prefersReducedMotion() ) {
			return;
		}

		const maxLength = Math.max( previousTarget.length, text.length );
		const totalMs = maxLength * FLAP_STAGGER_MS + FLAP_DURATION_MS;
		setTransition( { from: previousTarget, to: text } );
		setElapsed( 0 );
		const startTime = performance.now();
		let animationFrame = 0;

		const renderFrame = ( now: number ) => {
			const nextElapsed = now - startTime;
			if ( nextElapsed >= totalMs ) {
				setTransition( null );
				return;
			}
			setElapsed( nextElapsed );
			animationFrame = window.requestAnimationFrame( renderFrame );
		};

		animationFrame = window.requestAnimationFrame( renderFrame );

		return () => {
			window.cancelAnimationFrame( animationFrame );
			setTransition( null );
		};
	}, [ text ] );

	if ( ! transition ) {
		return <>{ text }</>;
	}

	const { from, to } = transition;
	const maxLength = Math.max( from.length, to.length );
	const characters = [];
	for ( let index = 0; index < maxLength; index++ ) {
		const fromCharacter = from.charAt( index ) || ' ';
		const toCharacter = to.charAt( index ) || ' ';
		const flips = fromCharacter !== toCharacter;
		const shown =
			flips && elapsed < index * FLAP_STAGGER_MS + FLAP_SWAP_MS ? fromCharacter : toCharacter;
		characters.push(
			<span
				key={ index }
				className={ clsx( styles.placeholderFlapChar, flips && styles.placeholderFlapFlip ) }
				style={ flips ? { animationDelay: `${ index * FLAP_STAGGER_MS }ms` } : undefined }
			>
				{ shown === ' ' ? '\u00A0' : shown }
			</span>
		);
	}

	return <span className={ styles.placeholderFlapRow }>{ characters }</span>;
}

/** Simple fade: the old suggestion fades out, the new one fades in. */
function FadePlaceholder( { text }: { text: string } ) {
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
		}, FADE_OUT_MS );

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
