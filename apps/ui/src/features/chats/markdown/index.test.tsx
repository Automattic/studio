import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CODE_TEXT_ATTRIBUTE } from '@/features/chats/use-text-context-menu';
import { renderWithProviders } from '@/test/render';
import { Markdown } from '.';

function renderMarkdown( children: string ) {
	return renderWithProviders( <Markdown>{ children }</Markdown> );
}

describe( 'Markdown', () => {
	it( 'highlights code in known languages with theme colors', async () => {
		const { container } = renderMarkdown( '```php\n<?php echo "Hi";\n```' );

		await waitFor( () =>
			expect( container.querySelector( 'pre span[style*="--shiki-dark"]' ) ).not.toBeNull()
		);
		expect( container.querySelector( 'pre' ) ).toHaveTextContent( '<?php echo "Hi";' );
	} );

	it( 'leaves code in unknown languages plain', async () => {
		const { container } = renderMarkdown( '```brainfuck\n+++\n```' );

		await screen.findByText( '+++' );
		await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
		expect( container.querySelector( 'pre span' ) ).toBeNull();
	} );

	it( 'labels fenced code blocks with their language and confirms the copy', async () => {
		const { connector } = renderMarkdown( '```js\nconst a = 1;\n```' );

		expect( await screen.findByText( 'js' ) ).toBeInTheDocument();
		const button = screen.getByRole( 'button', { name: 'Copy' } );
		expect( button.closest( `[${ CODE_TEXT_ATTRIBUTE }]` ) ).toHaveAttribute(
			CODE_TEXT_ATTRIBUTE,
			'const a = 1;'
		);

		fireEvent.click( button );

		expect( connector.copyText ).toHaveBeenCalledWith( 'const a = 1;' );
		await waitFor( () => expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Copied' ) );
		expect( screen.getByRole( 'button', { name: 'Copy' } ) ).toBeInTheDocument();
	} );

	it( 'shows a tooltip for the copy button', async () => {
		renderMarkdown( '```js\nconst a = 1;\n```' );

		const button = await screen.findByRole( 'button', { name: 'Copy' } );
		fireEvent.mouseEnter( button );
		fireEvent.mouseMove( button, { movementX: 1, movementY: 1 } );

		expect( await screen.findByText( 'Copy', {}, { timeout: 2000 } ) ).toBeVisible();
	} );
} );
