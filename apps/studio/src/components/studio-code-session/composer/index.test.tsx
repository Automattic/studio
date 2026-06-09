import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '.';
import type { ComposerSendAttachments } from './use-composer-attachments';

const defaultProps = {
	busy: false,
	error: null,
	model: DEFAULT_MODEL,
	onSend: vi.fn< ( prompt: string, attachments: ComposerSendAttachments ) => Promise< void > >(),
	onInterrupt: vi.fn< () => Promise< void > >(),
	entries: [],
};

function renderComposer( props: Partial< Parameters< typeof Composer >[ 0 ] > = {} ) {
	const queryClient = new QueryClient();
	return render(
		<QueryClientProvider client={ queryClient }>
			<Composer { ...defaultProps } sessionId="session-1" { ...props } />
		</QueryClientProvider>
	);
}

describe( 'Composer', () => {
	beforeEach( () => {
		localStorage.clear();
		defaultProps.onSend.mockReset();
		defaultProps.onInterrupt.mockReset();
		defaultProps.onSend.mockResolvedValue( undefined );
		defaultProps.onInterrupt.mockResolvedValue( undefined );
	} );

	it( 'restores unsent drafts for the same session', () => {
		const { unmount } = renderComposer();

		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'Update the homepage copy' },
		} );
		unmount();

		renderComposer();

		expect( screen.getByRole( 'combobox' ) ).toHaveValue( 'Update the homepage copy' );
	} );

	it( 'keeps drafts scoped to their session', () => {
		const { unmount } = renderComposer();

		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'Update the homepage copy' },
		} );
		unmount();

		renderComposer( { sessionId: 'session-2' } );

		expect( screen.getByRole( 'combobox' ) ).toHaveValue( '' );
	} );

	it( 'clears the stored draft after sending', async () => {
		const { unmount } = renderComposer();

		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'Update the homepage copy' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send' } ) );

		await waitFor( () => expect( defaultProps.onSend ).toHaveBeenCalled() );
		unmount();
		renderComposer();

		expect( screen.getByRole( 'combobox' ) ).toHaveValue( '' );
	} );
} );
