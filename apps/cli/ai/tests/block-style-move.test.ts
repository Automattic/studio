import { describe, expect, it } from 'vitest';
import { movableCss, withBlockStyle, withoutRules } from 'cli/ai/block-style-move';

describe( 'movableCss', () => {
	it.each( [
		{
			name: 'moves the rules of the class alone, its states nested',
			css: [
				'.card { background: #fff; border-radius: 8px }\n.card:hover, .card::after { box-shadow: 0 1px 2px #0003 }',
			],
			expected:
				'background: #fff; border-radius: 8px; &:hover { box-shadow: 0 1px 2px #0003; } &::after { box-shadow: 0 1px 2px #0003; }',
		},
		{
			name: 'reads every stylesheet, and leaves rules for what is inside the class',
			css: [ '.card { padding: 1rem; }', '.card h3 { margin: 0 }\n/* .grid .card { x } */' ],
			expected: 'padding: 1rem;',
		},
		{
			name: 'moves nothing a media query also styles, as its order against it would change',
			css: [ '.card { padding: 1rem }\n@media (max-width: 600px) { .card { padding: 0 } }' ],
			expected: undefined,
		},
		// As run 40's 01a1…712dc42208 stretched its cards in their columns.
		{
			name: 'leaves a rule for the class in a context, which outweighs the block style as it outweighed the class',
			css: [
				'.card { padding: 1rem }\n.wp-block-columns.features .wp-block-column > .card { width: 100% }\ndiv .card { margin: 0 }\n#features .card { order: 1 }\n:first-child > .card { margin: 0 }',
			],
			expected: 'padding: 1rem;',
		},
		{
			name: 'moves nothing a rule for the class in a context only as weighty as the block style also styles',
			css: [ '.card { padding: 1rem }\n* > .card { padding: 0 }' ],
			expected: undefined,
		},
		{
			name: 'moves nothing a rule styles in a context beside a state of its own',
			css: [ '.card { padding: 1rem }\n.card:hover, .grid .card { color: red }' ],
			expected: undefined,
		},
		{
			name: 'moves nothing a rule whose weight its arguments set also styles',
			css: [ '.card { padding: 1rem }\n:where(.grid) .card { padding: 0 }' ],
			expected: undefined,
		},
		{
			name: 'moves nothing a media query styles in a context',
			css: [ '.card { padding: 1rem }\n@media (max-width: 600px) { .grid .card { padding: 0 } }' ],
			expected: undefined,
		},
		{
			name: 'moves nothing a rule shares with another class',
			css: [ '.card, .tile { padding: 1rem }' ],
			expected: undefined,
		},
		{
			name: 'keeps braces in strings and comments out of the rules',
			css: [ '/* } */ .card::before { content: "}"; color: red }' ],
			expected: '&::before { content: "}"; color: red; }',
		},
		{
			name: 'has nothing to move for a class no rule styles',
			css: [ '.tile { x: 1 }' ],
			expected: undefined,
		},
	] )( '$name', ( { css, expected } ) => {
		expect( movableCss( css, 'card' ) ).toBe( expected );
	} );
} );

describe( 'withoutRules', () => {
	it( 'removes the rules of the class alone, and nothing else', () => {
		expect(
			withoutRules(
				'body { margin: 0 }\n.card { padding: 1rem }\n.card:hover { color: red }\n.card h3 { margin: 0 }\n.cards { gap: 1rem }\n',
				'card'
			)
		).toBe( 'body { margin: 0 }\n.card h3 { margin: 0 }\n.cards { gap: 1rem }\n' );
	} );
} );

describe( 'withBlockStyle', () => {
	const group = ( className: string, element = `<div class="wp-block-group ${ className }">` ) =>
		`<!-- wp:group {"className":"${ className }","layout":{"type":"constrained"}} -->\n${ element }<p>x</p></div>\n<!-- /wp:group -->`;

	it.each( [
		{
			name: 'adds the style beside the class, in the attributes and the element',
			markup: group( 'card reveal' ) + '\n' + group( 'cards' ),
			expected:
				group(
					'card reveal is-style-card',
					'<div class="wp-block-group card reveal is-style-card">'
				) +
				'\n' +
				group( 'cards' ),
		},
		{
			name: 'leaves a block that has the style',
			markup: group( 'card is-style-card' ),
			expected: group( 'card is-style-card' ),
		},
		{
			name: 'adds it to a block without an element, from its attributes',
			markup: '<!-- wp:post-title {"className":"card"} /-->',
			expected: '<!-- wp:post-title {"className":"card is-style-card"} /-->',
		},
		{
			name: 'cannot style a block whose element has no class to add it to',
			markup: group( 'card', '<div>' ),
			expected: undefined,
		},
	] )( '$name', ( { markup, expected } ) => {
		expect( withBlockStyle( markup, 'card' ) ).toBe( expected );
	} );
} );
