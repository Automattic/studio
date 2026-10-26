import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { TooltipProvider } from '@/lib/ui';
import { McpPanel } from './mcp-panel';
import type { ReactNode } from 'react';

vi.mock( '@/features/onboarding/learn-more', () => ( {
	LearnMoreLink: () => <a>Learn more</a>,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );

function Providers( { children }: { children: ReactNode } ) {
	return <TooltipProvider>{ children }</TooltipProvider>;
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

		expect(
			screen.getByText( /Connect other AI assistants to WordPress Studio/ )
		).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy MCP configuration' } ) );

		await waitFor( () => expect( copyText ).toHaveBeenCalledTimes( 1 ) );
		expect( copyText.mock.calls[ 0 ][ 0 ] ).toContain( 'wordpress-studio' );
		// The second copy button, after the install command's.
		await waitFor( () =>
			expect( screen.getAllByRole( 'status' )[ 1 ] ).toHaveTextContent( 'Copied' )
		);
	} );

	it( 'shows the install command before the configuration', () => {
		render( <McpPanel />, { wrapper: Providers } );

		expect( screen.getByText( 'npm install -g wp-studio' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Copy install command' } ) );

		expect( copyText ).toHaveBeenCalledWith( 'npm install -g wp-studio' );
	} );

	it( 'reports a failed copy instead of showing copied feedback', async () => {
		resetAppMessagesForTests();
		copyText.mockRejectedValueOnce( new Error( 'Clipboard unavailable' ) );
		render( <McpPanel />, { wrapper: Providers } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy MCP configuration' } ) );

		await waitFor( () =>
			expect( getNoticeHistory()[ 0 ] ).toMatchObject( {
				title: 'Could not copy.',
				description: 'Clipboard unavailable',
			} )
		);
		expect( screen.queryByText( 'Copied' ) ).not.toBeInTheDocument();
	} );
} );
