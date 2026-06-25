import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Markdown } from '.';

vi.mock( 'src/lib/get-ipc-api' );

describe( 'Studio Code Markdown', () => {
	const copyText = vi.fn();

	beforeEach( () => {
		copyText.mockClear();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( { copyText } );
	} );

	it( 'renders a copy button for fenced code blocks and copies the code', async () => {
		render( <Markdown>{ '```css\nbody { color: red; }\n```' }</Markdown> );

		const button = screen.getByRole( 'button', { name: 'Copy code' } );
		expect( button ).toBeInTheDocument();

		fireEvent.click( button );

		expect( copyText ).toHaveBeenCalledWith( 'body { color: red; }' );
		await waitFor( () => expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Copied' ) );
		expect( screen.getByRole( 'button', { name: 'Copy code' } ) ).toBeInTheDocument();
	} );

	it( 'shows a tooltip for the copy button', async () => {
		render( <Markdown>{ '```css\nbody { color: red; }\n```' }</Markdown> );

		fireEvent.mouseOver( screen.getByRole( 'button', { name: 'Copy code' } ) );

		await waitFor( () => expect( screen.getByRole( 'tooltip' ) ).toHaveTextContent( 'Copy code' ) );
	} );

	it( 'does not render a copy button for inline code', () => {
		render( <Markdown>{ 'this is `inline` code' }</Markdown> );

		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );
} );
