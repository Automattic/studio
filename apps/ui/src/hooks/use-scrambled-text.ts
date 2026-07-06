import { useEffect, useRef, useState } from 'react';

const SCRAMBLE_DURATION_MS = 420;
const SCRAMBLE_STAGGER_MS = 12;
const SCRAMBLE_TICK_MS = 32;
const SCRAMBLE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789!?*+-=';

function getScrambleCharacter( index: number, elapsed: number ) {
	const characterIndex =
		( index * 7 + Math.floor( elapsed / SCRAMBLE_TICK_MS ) ) % SCRAMBLE_CHARS.length;
	return SCRAMBLE_CHARS.charAt( characterIndex );
}

/**
 * Decode-style text transition: when `targetText` changes, the old text
 * dissolves character by character (staggered left to right) through a
 * scramble alphabet and resolves into the new text. Used by the composer
 * placeholder and the thinking indicator so message changes share one
 * motion signature. Respects `prefers-reduced-motion` by snapping.
 */
export function useScrambledText( targetText: string, shouldAnimate: boolean ) {
	const [ displayText, setDisplayText ] = useState( targetText );
	const previousTargetRef = useRef( targetText );

	useEffect( () => {
		const previousText = previousTargetRef.current;
		previousTargetRef.current = targetText;

		if ( previousText === targetText || ! shouldAnimate ) {
			setDisplayText( targetText );
			return;
		}

		if ( window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ) {
			setDisplayText( targetText );
			return;
		}

		const maxLength = Math.max( previousText.length, targetText.length );
		const startTime = performance.now();
		let animationFrame = 0;

		const renderFrame = ( now: number ) => {
			const elapsed = now - startTime;
			let isComplete = true;
			let nextText = '';

			for ( let index = 0; index < maxLength; index++ ) {
				const previousCharacter = previousText.charAt( index );
				const targetCharacter = targetText.charAt( index );
				const characterElapsed = elapsed - index * SCRAMBLE_STAGGER_MS;

				if ( characterElapsed <= 0 ) {
					nextText += previousCharacter;
					isComplete = false;
					continue;
				}

				if ( characterElapsed >= SCRAMBLE_DURATION_MS ) {
					nextText += targetCharacter;
					continue;
				}

				isComplete = false;
				nextText +=
					previousCharacter === ' ' && targetCharacter === ' '
						? ' '
						: getScrambleCharacter( index, elapsed );
			}

			setDisplayText( nextText.trimEnd() );

			if ( isComplete ) {
				setDisplayText( targetText );
				return;
			}

			animationFrame = window.requestAnimationFrame( renderFrame );
		};

		animationFrame = window.requestAnimationFrame( renderFrame );

		return () => {
			window.cancelAnimationFrame( animationFrame );
		};
	}, [ targetText, shouldAnimate ] );

	return displayText;
}
