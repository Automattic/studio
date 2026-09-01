import { describe, expect, it } from 'vitest';
import {
	appendScrollDrivenAnimations,
	detectPausedAnimationRules,
	withoutPausedKeyword,
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
		expect( rules[ 0 ].sourceSelector ).toBe(
			'#main :where(.comp-a):not([data-motion-enter="done"])'
		);
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

describe( 'withoutPausedKeyword', () => {
	it( 'strips the keyword from a single layer', () => {
		expect( withoutPausedKeyword( 'motion-floatIn 1200ms linear backwards 1 paused' ) ).toBe(
			'motion-floatIn 1200ms linear backwards 1'
		);
	} );

	// The regression: `paused` is followed by the comma separating the layers, so
	// a pattern that consumes the trailing delimiter deletes the comma too. The
	// two layers weld into one, which is invalid, and the browser drops the whole
	// declaration — every element using it then renders with no animation at all.
	it( 'keeps the comma that separates two layers', () => {
		const value =
			'motion-fadeIn 1200ms 1ms linear backwards 1 paused, motion-expandIn 1200ms 1ms cubic-bezier(0.645, 0.045, 0.355, 1) backwards 1 paused';
		expect( withoutPausedKeyword( value ) ).toBe(
			'motion-fadeIn 1200ms 1ms linear backwards 1, motion-expandIn 1200ms 1ms cubic-bezier(0.645, 0.045, 0.355, 1) backwards 1'
		);
	} );

	it( 'strips the keyword from every layer, not just the first', () => {
		expect(
			withoutPausedKeyword( 'a 1s paused, b 2s paused, c 3s paused' )
		).toBe( 'a 1s, b 2s, c 3s' );
	} );

	it( 'leaves an animation name containing the word alone', () => {
		expect( withoutPausedKeyword( 'paused-pulse 1s linear 1' ) ).toBe(
			'paused-pulse 1s linear 1'
		);
	} );

	it( 'preserves commas inside timing functions', () => {
		expect(
			withoutPausedKeyword( 'a 1s cubic-bezier(0.4, 0, 0.2, 1) paused' )
		).toBe( 'a 1s cubic-bezier(0.4, 0, 0.2, 1)' );
	} );
} );

describe( 'appendScrollDrivenAnimations', () => {
	it( 'drives a gated entrance from the scroll timeline', () => {
		const out = appendScrollDrivenAnimations( '.base{color:red}', gatedEntrance );
		expect( out ).toContain( '.base{color:red}' );
		expect( out ).toContain( '@supports (animation-timeline: view())' );
		expect( out ).toContain( 'animation-timeline:view()' );
		expect( out ).toContain( 'animation-play-state:running' );
		expect( out ).not.toContain( ':not([data-motion-enter="done"])' );
	} );

	it( 'returns the sheet unchanged when nothing is gated', () => {
		const css = '.a{color:red}';
		expect( appendScrollDrivenAnimations( css, '.a{color:red}' ) ).toBe( css );
	} );

	it( 'removes capture-time completion gates from the self-driving rule', () => {
		const out = appendScrollDrivenAnimations( '', gatedEntrance );
		expect( out ).toContain( '#main :where(.comp-a){' );
		expect( out ).not.toContain( ':not([data-motion-enter="done"])' );
	} );

	// A real two-layer entrance rule, as builders emit it. The emitted override
	// has to stay parseable: `animation-composition` already declares two layers,
	// so a shorthand that declares one contradicts it and the rule is dead CSS.
	it( 'emits a valid shorthand for a two-layer entrance', () => {
		const source = `
#comp-a:not([data-motion-enter="done"]) {
  animation: motion-fadeIn 1200ms 1ms linear backwards 1 paused, motion-expandIn 1200ms 1ms cubic-bezier(0.645, 0.045, 0.355, 1) backwards 1 paused;
  animation-composition: replace, replace;
}
`;
		const out = appendScrollDrivenAnimations( '', source );
		const emitted = /animation:([^;]+);/.exec( out )?.[ 1 ] ?? '';

		expect( emitted ).toBe(
			'motion-fadeIn 1200ms 1ms linear backwards 1, motion-expandIn 1200ms 1ms cubic-bezier(0.645, 0.045, 0.355, 1) backwards 1'
		);

		// Both layers survive as layers: the separator between them is intact, and
		// splitting on top-level commas still yields two.
		const layers = emitted.replace( /\([^)]*\)/g, '()' ).split( ',' );
		expect( layers ).toHaveLength( 2 );
		expect( layers[ 0 ] ).toContain( 'motion-fadeIn' );
		expect( layers[ 1 ] ).toContain( 'motion-expandIn' );
	} );
} );
