import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatedPlaceholder, PLACEHOLDER_FADE_DURATION_MS } from './animated-placeholder';
import styles from './style.module.css';

describe( 'AnimatedPlaceholder', () => {
	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'quickly fades between placeholder suggestions', () => {
		vi.useFakeTimers();
		const { rerender } = render( <AnimatedPlaceholder text="First suggestion" /> );

		rerender( <AnimatedPlaceholder text="Next suggestion" /> );

		expect( screen.getByText( 'First suggestion' ) ).toHaveClass( styles.placeholderFadeOut );

		act( () => {
			vi.advanceTimersByTime( PLACEHOLDER_FADE_DURATION_MS );
		} );

		expect( screen.getByText( 'Next suggestion' ) ).toHaveClass( styles.placeholderFadeIn );
	} );
} );
