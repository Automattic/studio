import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/features/chats/markdown';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';

const samples = {
	text: 'I can help you build and manage WordPress sites right here in Studio. Tell me what you want to accomplish, or ask me to review the current site.\n\nUse **bold** for emphasis, *italics* for a note, and ~~strikethrough~~ for a correction. Review the [WordPress documentation](https://wordpress.org/documentation/) before changing `wp-config.php`.',
	lists:
		'- **Design or redesign** — create a homepage, landing page, or custom block theme; refine typography, colors, and layouts.\n- **Create content** — write and edit pages, posts, menus, and reusable patterns with editable WordPress blocks.\n  - Keep the existing palette.\n  - Check desktop and mobile layouts.\n\n1. Review the homepage.\n2. Check navigation.\n3. Publish the changes.\n\n- [x] Review spacing\n- [ ] Confirm the final copy',
	headings:
		'# Site review\n\nThe homepage is ready for review.\n\n## What changed\n\nThe content has a clearer hierarchy.\n\n### Next steps\n\n> Keep the page focused on one clear action.\n\n---\n\n#### Details\n\n##### Notes\n\n###### References\n\nAll heading levels stay proportional to the conversation.',
	table:
		'| Page | Status | Next step |\n| :--- | :---: | ---: |\n| Homepage | Ready | Review |\n| About | Draft | Edit |\n\n| File | Purpose | Notes |\n| --- | --- | --- |\n| `a-very-long-filename-that-must-remain-readable-without-widening-the-conversation.php` | A deliberately wide table to check horizontal scrolling | Keep the surrounding chat within its width |\n\nhttps://example.com/a/deliberately/long/path/that/should/wrap/within/the/message/without/expanding/the/chat',
	code: '```css\n.hero {\n  padding: 2rem;\n  grid-template-columns: repeat(3, minmax(15rem, 1fr));\n}\n```\n\n```studio-example\nUnknown language names should still show readable, copyable plain text.\n```',
	fallbacks:
		'```mermaid\nflowchart LR\n  Draft --> Review --> Publish\n```\n\nMath stays as source text: $E = mc^2$.\n\nThese formats do not currently have rendering plugins enabled.',
};

function renderMarkdown( markdown: string, connector = createFakeConnector() ) {
	const view = renderWithProviders( <Markdown>{ markdown }</Markdown>, { connector } );
	return { ...view, connector };
}

describe( 'chat response formats', () => {
	it( 'renders nested lists, task lists, tables, and every heading level', async () => {
		renderMarkdown( [ samples.lists, samples.headings, samples.table ].join( '\n\n' ) );
		await screen.findByRole( 'heading', { level: 1 } );
		expect( screen.getAllByRole( 'list' ).length ).toBeGreaterThanOrEqual( 4 );
		expect( screen.getAllByRole( 'checkbox' ) ).toHaveLength( 2 );
		expect( screen.getAllByRole( 'table' ) ).toHaveLength( 2 );
		for ( const level of [ 1, 2, 3, 4, 5, 6 ] ) {
			expect( screen.getByRole( 'heading', { level } ) ).toBeVisible();
		}
	} );

	it( 'opens links through the host and keeps inline code separate from code blocks', async () => {
		const { connector } = renderMarkdown( samples.text );
		expect( ( await screen.findByText( 'wp-config.php' ) ).tagName ).toBe( 'CODE' );
		fireEvent.click( screen.getByRole( 'link', { name: 'WordPress documentation' } ) );
		await waitFor( () =>
			expect( connector.openExternalUrl ).toHaveBeenCalledWith(
				'https://wordpress.org/documentation/'
			)
		);
		expect( screen.queryByRole( 'button', { name: 'Copy' } ) ).not.toBeInTheDocument();
	} );

	it( 'copies fenced code through the host and preserves unknown-language and diagram source', async () => {
		const { connector } = renderMarkdown( `${ samples.code }\n\n${ samples.fallbacks }` );
		expect( await screen.findAllByRole( 'button', { name: 'Copy' } ) ).toHaveLength( 3 );
		fireEvent.click( screen.getAllByRole( 'button', { name: 'Copy' } )[ 0 ] );
		await waitFor( () =>
			expect( connector.copyText ).toHaveBeenCalledWith(
				'.hero {\n  padding: 2rem;\n  grid-template-columns: repeat(3, minmax(15rem, 1fr));\n}'
			)
		);
		expect( screen.getByText( /Unknown language names should still show/ ) ).toBeVisible();
		expect( screen.getByText( 'Draft --> Review --> Publish', { exact: false } ) ).toBeVisible();
	} );

	it( 'renders incomplete Markdown safely while a response is streaming', async () => {
		let setText!: ( text: string ) => void;
		function Streaming() {
			const [ text, set ] = useState( 'The **homepage' );
			setText = set;
			return <Markdown>{ text }</Markdown>;
		}
		renderWithProviders( <Streaming /> );
		expect( await screen.findByText( /homepage/ ) ).toBeVisible();
		act( () => setText( 'The **homepage** is ready.\n\n```css\n.hero {' ) );
		expect( await screen.findByText( '.hero {' ) ).toBeVisible();
	} );

	it( 'renders images with alternative text and strips executable HTML', async () => {
		const { container } = renderMarkdown(
			'![Site preview](https://example.com/preview.png)\n\n<script>alert(1)</script>\n\n<img src="https://example.com/image.png" onerror="alert(1)" />'
		);
		expect( await screen.findByRole( 'img', { name: 'Site preview' } ) ).toHaveAttribute(
			'src',
			'https://example.com/preview.png'
		);
		expect( container.querySelector( 'script, [onerror]' ) ).toBeNull();
	} );
} );
