import { describe, expect, it } from 'vitest';
import { planMove, withBlockStyle } from 'cli/ai/block-style-move';

describe( 'planMove', () => {
	it.each< {
		name: string;
		css: string[];
		blockTypes?: string[];
		expected?: { css: string; stylesheets: string[]; kept: string[] };
	} >( [
		{
			name: 'moves the rules of the class alone, its states nested',
			css: [
				'body { margin: 0 }\n.card { background: #fff; border-radius: 8px }\n.card:hover, .card::after { box-shadow: 0 1px 2px #0003 }\n',
			],
			expected: {
				css: 'background: #fff; border-radius: 8px; &:hover { box-shadow: 0 1px 2px #0003; } &::after { box-shadow: 0 1px 2px #0003; }',
				stylesheets: [ 'body { margin: 0 }\n' ],
				kept: [],
			},
		},
		{
			name: 'reads every stylesheet in order, and leaves rules for what is inside the class',
			css: [
				'.card { padding: 1rem; }',
				'.card h3 { margin: 0 }\n.card { color: red }\n/* .grid .card { x } */',
			],
			expected: {
				css: 'padding: 1rem; color: red;',
				stylesheets: [ '', '.card h3 { margin: 0 }\n/* .grid .card { x } */' ],
				kept: [],
			},
		},
		// As run 53's 01a1…36132 aligned its cards on small screens.
		{
			name: 'keeps beside the class what a media query also sets, which meet in the stylesheet as before',
			css: [
				'.card {\n\tbackground: #fff;\n\tpadding-top: 2rem;\n\tmargin: 0;\n\t/* why: rows */ align-items: flex-start;\n}\n@media (max-width: 781px) {\n\t.card {\n\t\talign-items: center; padding: 0; margin-left: 1rem;\n\t}\n}\n',
			],
			expected: {
				css: 'background: #fff;',
				stylesheets: [
					'.card {\n\tpadding-top: 2rem;\n\tmargin: 0;\n\t/* why: rows */ align-items: flex-start;\n}\n@media (max-width: 781px) {\n\t.card {\n\t\talign-items: center; padding: 0; margin-left: 1rem;\n\t}\n}\n',
				],
				kept: [ 'padding-top', 'margin', 'align-items' ],
			},
		},
		{
			name: 'moves nothing every declaration of which a media query also sets',
			css: [ '.card { padding: 1rem }\n@media (max-width: 600px) { .grid .card { padding: 0 } }' ],
			expected: undefined,
		},
		// As run 40's 01a1…712dc42208 stretched its cards in their columns.
		{
			name: 'leaves a rule for the class in a context, which outweighs the block style as it outweighed the class',
			css: [
				'.card { padding: 1rem }\n.wp-block-columns.features .wp-block-column > .card { width: 100% }\ndiv .card { margin: 0 }\n#features .card { order: 1 }\n',
			],
			expected: {
				css: 'padding: 1rem;',
				stylesheets: [
					'.wp-block-columns.features .wp-block-column > .card { width: 100% }\ndiv .card { margin: 0 }\n#features .card { order: 1 }\n',
				],
				kept: [],
			},
		},
		{
			name: 'keeps what a rule for the class in a context only as weighty as the block style, or weighed by its arguments, also sets',
			css: [
				'.card { padding: 1rem; color: red }\n* > .card { padding: 0 }\n:where(.grid) .card { color: blue }',
			],
			expected: undefined,
		},
		// As run 53's 01a1…36133 listed its cards beside the groups inside them.
		{
			name: 'splits a list the class shares, the other selectors keeping the rule',
			css: [
				'.card,\n.card .wp-block-group {\n\tpadding: 2rem;\n}\n.card .wp-block-group { padding: 0 }\n.card:hover, .grid .card { color: red }',
			],
			expected: {
				css: 'padding: 2rem; &:hover { color: red; }',
				stylesheets: [
					'.card .wp-block-group {\n\tpadding: 2rem;\n}\n.card .wp-block-group { padding: 0 }\n.grid .card { color: red }',
				],
				kept: [],
			},
		},
		// As run 52's 01a1…13710 styled its feature cards.
		{
			name: 'moves the rules of the class beside the class of the block types that carry it',
			css: [
				'.wp-block-group.card { padding: 1rem }\n.card.wp-block-group:hover { color: red }\n.wp-block-column.card { margin: 0 }',
			],
			blockTypes: [ 'core/group' ],
			expected: {
				css: 'padding: 1rem; &:hover { color: red; }',
				stylesheets: [ '.wp-block-column.card { margin: 0 }' ],
				kept: [],
			},
		},
		{
			name: 'moves a class beside CSS nesting of another',
			css: [ '.tile { & a { color: red } }\n.card { padding: 1rem }' ],
			expected: {
				css: 'padding: 1rem;',
				stylesheets: [ '.tile { & a { color: red } }\n' ],
				kept: [],
			},
		},
		{
			name: 'moves nothing of a class CSS nesting styles',
			css: [ '.card { padding: 1rem; & h3 { margin: 0 } }' ],
			expected: undefined,
		},
		{
			name: 'keeps semicolons and braces in strings and comments in their declarations',
			css: [ '/* } */ .card::before { content: "};"; color: red }' ],
			expected: {
				css: '&::before { content: "};"; color: red; }',
				stylesheets: [ '/* } */ ' ],
				kept: [],
			},
		},
		{
			name: 'writes the selectors it leaves as they were',
			css: [ '.card, a[title="x, y"] /* a, b */ { color: red }' ],
			expected: {
				css: 'color: red;',
				stylesheets: [ 'a[title="x, y"] /* a, b */ { color: red }' ],
				kept: [],
			},
		},
		{
			name: 'has nothing to move for a class no rule styles',
			css: [ '.tile { x: 1 }' ],
			expected: undefined,
		},
	] )( '$name', ( { css, blockTypes, expected } ) => {
		expect( planMove( css, 'card', blockTypes ) ).toEqual( expected );
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
