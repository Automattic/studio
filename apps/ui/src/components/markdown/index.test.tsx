import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from '.';

const { copyText } = vi.hoisted( () => ( { copyText: vi.fn() } ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		openExternalUrl: vi.fn(),
		copyText,
	} ),
} ) );

function renderMarkdown( children: string ) {
	return render(
		<Tooltip.Provider>
			<Markdown>{ children }</Markdown>
		</Tooltip.Provider>
	);
}

describe( 'Markdown', () => {
	beforeEach( () => {
		copyText.mockClear();
	} );

	it( 'renders a copy button for fenced code blocks and copies the code', async () => {
		renderMarkdown( '```js\nconst a = 1;\n```' );

		const button = screen.getByRole( 'button', { name: 'Copy code' } );
		expect( button ).toBeInTheDocument();

		fireEvent.click( button );

		expect( copyText ).toHaveBeenCalledWith( 'const a = 1;' );
		await waitFor( () => expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Copied' ) );
		expect( screen.getByRole( 'button', { name: 'Copy code' } ) ).toBeInTheDocument();
	} );

	it( 'shows a tooltip for the copy button', async () => {
		renderMarkdown( '```js\nconst a = 1;\n```' );

		const button = screen.getByRole( 'button', { name: 'Copy code' } );
		fireEvent.mouseEnter( button );
		fireEvent.mouseMove( button, { movementX: 1, movementY: 1 } );

		expect( await screen.findByText( 'Copy code', {}, { timeout: 2000 } ) ).toBeVisible();
	} );

	it( 'does not render a copy button for inline code', () => {
		renderMarkdown( 'this is `inline` code' );

		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );
} );
