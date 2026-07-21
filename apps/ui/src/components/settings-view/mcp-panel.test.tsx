import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { McpPanel } from './mcp-panel';
import type { ReactNode } from 'react';

vi.mock( '@/components/learn-more', () => ( {
	LearnMoreLink: () => <a>Learn more</a>,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );

function Providers( { children }: { children: ReactNode } ) {
	return <Tooltip.Provider>{ children }</Tooltip.Provider>;
}

describe( 'McpPanel', () => {
	const copyText = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		copyText.mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( { copyText } as never );
	} );

	it( 'copies the MCP configuration and shows copied feedback once the copy resolves', async () => {
		render( <McpPanel />, { wrapper: Providers } );

		expect( screen.getByRole( 'heading', { name: 'MCP' } ) ).toBeInTheDocument();
		expect( screen.getByText( /MCP lets other AI tools talk to Studio/ ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy MCP configuration' } ) );

		await waitFor( () => expect( copyText ).toHaveBeenCalledTimes( 1 ) );
		expect( copyText.mock.calls[ 0 ][ 0 ] ).toContain( 'wordpress-studio' );
		await waitFor( () => expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Copied' ) );
	} );

	it( 'does not show copied feedback when the copy fails', async () => {
		const error = new Error( 'Clipboard unavailable' );
		const consoleError = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		copyText.mockRejectedValueOnce( error );

		try {
			render( <McpPanel />, { wrapper: Providers } );

			fireEvent.click( screen.getByRole( 'button', { name: 'Copy MCP configuration' } ) );

			await waitFor( () =>
				expect( consoleError ).toHaveBeenCalledWith( 'Failed to copy text:', error )
			);
			expect( screen.queryByText( 'Copied' ) ).not.toBeInTheDocument();
			expect( screen.getByRole( 'status' ) ).toHaveTextContent( '' );
		} finally {
			consoleError.mockRestore();
		}
	} );
} );
