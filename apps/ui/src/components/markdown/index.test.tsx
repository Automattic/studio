import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CODE_TEXT_ATTRIBUTE } from '@/hooks/use-text-context-menu';
import { Markdown } from '.';

const { copyText } = vi.hoisted( () => ( {
	copyText: vi.fn( () => Promise.resolve() ),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		openExternalUrl: vi.fn(),
		copyText,
	} ),
} ) );

function renderMarkdown( children: string ) {
	return render( <Markdown>{ children }</Markdown> );
}

describe( 'Markdown', () => {
	beforeEach( () => {
		copyText.mockClear();
	} );

	it( 'highlights code in known languages with theme colors', async () => {
		const { container } = renderMarkdown( '```php\n<?php echo "Hi";\n```' );

		await waitFor( () =>
			expect( container.querySelector( 'pre span[style*="--shiki-dark"]' ) ).not.toBeNull()
		);
		expect( container.querySelector( 'pre' ) ).toHaveTextContent( '<?php echo "Hi";' );
	} );

	it( 'leaves code in unknown languages plain', async () => {
		const { container } = renderMarkdown( '```brainfuck\n+++\n```' );

		await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
		expect( container.querySelector( 'pre span' ) ).toBeNull();
		expect( container.querySelector( 'pre' ) ).toHaveTextContent( '+++' );
	} );

	it( 'labels fenced code blocks with their language and copies the code', async () => {
		renderMarkdown( '```js\nconst a = 1;\n```' );

		expect( screen.getByText( 'js' ) ).toBeInTheDocument();
		const button = screen.getByRole( 'button', { name: 'Copy' } );
		expect( button.closest( `[${ CODE_TEXT_ATTRIBUTE }]` ) ).toHaveAttribute(
			CODE_TEXT_ATTRIBUTE,
			'const a = 1;'
		);

		fireEvent.click( button );

		expect( copyText ).toHaveBeenCalledWith( 'const a = 1;' );
		await waitFor( () => expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Copied' ) );
		expect( screen.getByRole( 'button', { name: 'Copy' } ) ).toBeInTheDocument();
	} );

	it( 'shows a tooltip for the copy button', async () => {
		renderMarkdown( '```js\nconst a = 1;\n```' );

		const button = screen.getByRole( 'button', { name: 'Copy' } );
		fireEvent.mouseEnter( button );
		fireEvent.mouseMove( button, { movementX: 1, movementY: 1 } );

		expect( await screen.findByText( 'Copy', {}, { timeout: 2000 } ) ).toBeVisible();
	} );

	it( 'does not render a copy button for inline code', () => {
		renderMarkdown( 'this is `inline` code' );

		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );
} );
