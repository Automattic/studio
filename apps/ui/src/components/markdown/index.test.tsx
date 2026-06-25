import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from '.';

const { copyText } = vi.hoisted( () => ( { copyText: vi.fn() } ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		openExternalUrl: vi.fn(),
		copyText,
	} ),
} ) );

describe( 'Markdown', () => {
	beforeEach( () => {
		copyText.mockClear();
	} );

	it( 'renders a copy button for fenced code blocks and copies the code', async () => {
		render( <Markdown>{ '```js\nconst a = 1;\n```' }</Markdown> );

		const button = screen.getByRole( 'button', { name: 'Copy code' } );
		expect( button ).toBeInTheDocument();

		fireEvent.click( button );

		expect( copyText ).toHaveBeenCalledWith( 'const a = 1;' );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Copied' } ) ).toBeInTheDocument()
		);
	} );

	it( 'does not render a copy button for inline code', () => {
		render( <Markdown>{ 'this is `inline` code' }</Markdown> );

		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );
} );
