import { describe, expect, it } from 'vitest';
import {
	appendScrollDrivenAnimations,
	detectPausedAnimationRules,
} from './scroll-driven-animations.js';

const gatedEntrance = `
@keyframes motion-floatIn { 0% { opacity: 0 } 100% { opacity: 1 } }
@media (prefers-reduced-motion: no-preference) {
  #main :where(.comp-a):not([data-motion-enter="done"]) {
    animation: motion-floatIn 1200ms cubic-bezier(0.445,0.05,0.55,0.95) backwards 1 paused;
    --motion-translate-y: 60px;
  }
}
`;

describe( 'detectPausedAnimationRules', () => {
	it( 'recovers a script-gated entrance without its state gate', () => {
		const rules = detectPausedAnimationRules( gatedEntrance );
		expect( rules ).toHaveLength( 1 );
		expect( rules[ 0 ].selector ).toBe( '#main :where(.comp-a)' );
		expect( rules[ 0 ].declarations ).toContain( 'motion-floatIn' );
		expect( rules[ 0 ].declarations ).not.toContain( 'paused' );
		expect( rules[ 0 ].declarations ).toContain( '--motion-translate-y:60px' );
	} );

	it( 'leaves infinite ambient motion alone', () => {
		const rules = detectPausedAnimationRules(
			`.spinner{animation:spin 1s linear infinite paused}`
		);
		expect( rules ).toEqual( [] );
	} );

	it( 'ignores paused text inside keyframes', () => {
		const rules = detectPausedAnimationRules(
			`@keyframes paused { from { opacity: 0 } to { opacity: 1 } }`
		);
		expect( rules ).toEqual( [] );
	} );

	it( 'ignores animations that already run', () => {
		const rules = detectPausedAnimationRules( `.a{animation:fade 1s both 1}` );
		expect( rules ).toEqual( [] );
	} );
} );

describe( 'appendScrollDrivenAnimations', () => {
	it( 'drives a gated entrance from the scroll timeline', () => {
		const out = appendScrollDrivenAnimations( '.base{color:red}', gatedEntrance );
		expect( out ).toContain( '.base{color:red}' );
		expect( out ).toContain( '@supports (animation-timeline: view())' );
		expect( out ).toContain( 'animation-timeline:view()' );
		expect( out ).toContain( 'animation-play-state:running' );
		expect( out ).not.toContain( 'data-motion-enter' );
	} );

	it( 'returns the sheet unchanged when nothing is gated', () => {
		const css = '.a{color:red}';
		expect( appendScrollDrivenAnimations( css, '.a{color:red}' ) ).toBe( css );
	} );
} );
