import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { closeOpenMarkdown, splitMarkdownBlocks } from './blocks';

const html = ( markdown: string ) =>
	renderToStaticMarkup( createElement( ReactMarkdown, { remarkPlugins: [ remarkGfm ] }, markdown ) )
		.replace( />\s+/g, '>' )
		.replace( /\s+</g, '<' );

const SAMPLES = {
	reply: `# Menu page plan

Here is the plan for the **Bistro Lune** menu page.

1. A hero
2. The menu:
   - Starters
   - Mains

> Prices change weekly.

\`\`\`php
<?php

function price() {}
\`\`\`

| Course | Price |
| --- | --- |
| Mains | €21 |

---

Shall I start?`,
	looseList: '- one\n\n- two\n\n  still two\n\n- three\n\nAfter the list.',
	orderedRuns: '1. first\n\nA paragraph.\n\n2. second\n3. third',
	paragraphThenList: 'Steps:\n- one\n- two\n\n- three',
	fenceWithBlankLines: '~~~\na\n\n\nb\n~~~~\n\nAfter.',
	unclosedFence: 'Code:\n\n```js\nconst a = 1;\n\nconst b = 2;',
	indentedCode: 'Para.\n\n    indented code\n\n    more\n\nEnd.',
	htmlComment: 'Before.\n\n<!-- wp:paragraph\n\nstill a comment -->\n\nAfter.',
	references: 'See [the docs][docs].\n\nMore text.\n\n[docs]: https://wordpress.org',
	footnotes: 'A claim.[^1]\n\nMore.\n\n[^1]: The source.',
	blockquotes: '> one\n\n> two\n\nPlain.',
};

describe( 'splitMarkdownBlocks', () => {
	it.each( Object.entries( SAMPLES ) )(
		'renders %s block by block exactly as a whole',
		( _name, markdown ) => {
			expect( splitMarkdownBlocks( markdown ).map( html ).join( '' ) ).toBe( html( markdown ) );
		}
	);

	it( 'splits a reply at its top-level blocks', () => {
		expect( splitMarkdownBlocks( SAMPLES.reply ) ).toHaveLength( 8 );
		expect( splitMarkdownBlocks( SAMPLES.looseList ) ).toEqual( [
			'- one\n\n- two\n\n  still two\n\n- three\n',
			'After the list.',
		] );
	} );
} );

describe( 'closeOpenMarkdown', () => {
	it( 'closes bold and inline code a streaming block has opened', () => {
		expect( closeOpenMarkdown( 'The **Bistro' ) ).toBe( 'The **Bistro**' );
		expect( closeOpenMarkdown( 'Run `npm' ) ).toBe( 'Run `npm`' );
		expect( closeOpenMarkdown( 'The **`theme' ) ).toBe( 'The **`theme`**' );
	} );

	it( 'drops a marker that has nothing after it yet', () => {
		expect( closeOpenMarkdown( 'The **' ) ).toBe( 'The' );
	} );

	it( 'leaves balanced text and open code fences alone', () => {
		expect( closeOpenMarkdown( 'The **Bistro** and `code`' ) ).toBe( 'The **Bistro** and `code`' );
		expect( closeOpenMarkdown( '```js\nconst a = `b' ) ).toBe( '```js\nconst a = `b' );
	} );
} );
