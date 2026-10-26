import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { AccountPromptDialog } from './index';

vi.mock( '@/data/core', () => ( { useConnector: vi.fn() } ) );

describe( 'AccountPromptDialog', () => {
	it( 'keeps a login started before the prompt was closed and reopened from starting again', async () => {
		const authenticate = vi.fn( () => new Promise< void >( () => {} ) );
		vi.mocked( useConnector, { partial: true } ).mockReturnValue( { authenticate } );
		const queryClient = new QueryClient();
		const renderPrompt = ( open: boolean ) => (
			<QueryClientProvider client={ queryClient }>
				<AccountPromptDialog
					open={ open }
					onOpenChange={ () => {} }
					title="Do more with WordPress.com"
					description="Log in to share your site."
					source="unknown"
				/>
			</QueryClientProvider>
		);
		const view = render( renderPrompt( true ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Log in to WordPress.com' } ) );
		await waitFor( () => expect( authenticate ).toHaveBeenCalledTimes( 1 ) );

		view.rerender( renderPrompt( false ) );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		view.rerender( renderPrompt( true ) );

		const logIn = await screen.findByRole( 'button', { name: 'Log in to WordPress.com' } );
		expect( logIn ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( logIn );
		expect( authenticate ).toHaveBeenCalledTimes( 1 );
	} );
} );
