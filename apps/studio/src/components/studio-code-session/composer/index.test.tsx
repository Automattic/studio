import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSessionDraft, Composer } from '.';
import type { ComposerSendAttachments } from './use-composer-attachments';

const defaultProps = {
	busy: false,
	error: null,
	model: DEFAULT_MODEL,
	onSend: vi.fn< ( prompt: string, attachments: ComposerSendAttachments ) => Promise< void > >(),
	onInterrupt: vi.fn< () => Promise< void > >(),
	entries: [],
};

function createMemoryStorage(): Storage {
	const values = new Map< string, string >();
	return {
		get length() {
			return values.size;
		},
		clear: vi.fn( () => values.clear() ),
		getItem: vi.fn( ( key: string ) => values.get( key ) ?? null ),
		key: vi.fn( ( index: number ) => Array.from( values.keys() )[ index ] ?? null ),
		removeItem: vi.fn( ( key: string ) => {
			values.delete( key );
		} ),
		setItem: vi.fn( ( key: string, value: string ) => {
			values.set( key, value );
		} ),
	};
}

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
		Object.defineProperty( globalThis, 'localStorage', {
			value: createMemoryStorage(),
			configurable: true,
		} );
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

	it( 'clears a stored draft by session id', () => {
		localStorage.setItem( 'studio_code_session_draft:session-1', 'Update the homepage copy' );

		clearSessionDraft( 'session-1' );

		expect( localStorage.getItem( 'studio_code_session_draft:session-1' ) ).toBeNull();
	} );

	it( 'clears the live textarea when an empty draft prompt is pushed', () => {
		// "New conversation" reuses the current session id when it's empty, so it
		// resets the composer by pushing an empty draft prompt rather than relying
		// on the session-change resync.
		const { rerender } = render(
			<QueryClientProvider client={ new QueryClient() }>
				<Composer { ...defaultProps } sessionId="session-1" />
			</QueryClientProvider>
		);

		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'Update the homepage copy' },
		} );
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( 'Update the homepage copy' );

		rerender(
			<QueryClientProvider client={ new QueryClient() }>
				<Composer { ...defaultProps } sessionId="session-1" draftPrompt={ { id: 1, prompt: '' } } />
			</QueryClientProvider>
		);

		expect( screen.getByRole( 'combobox' ) ).toHaveValue( '' );
		expect( localStorage.getItem( 'studio_code_session_draft:session-1' ) ).toBeNull();
	} );

	it( 'can place slash-command suggestions below the textarea', () => {
		renderComposer( { slashCommandPlacement: 'bottom' } );

		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: '/' },
		} );

		expect( screen.getByRole( 'listbox', { name: 'Slash commands' } ) ).toHaveAttribute(
			'data-side',
			'bottom'
		);
	} );

	it( 'can use instance-local slash commands', () => {
		renderComposer( {
			slashCommands: [ { name: 'fix-plugin', description: 'Fix Plugin Check errors' } ],
		} );

		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: '/' },
		} );

		expect( screen.getByText( '/fix-plugin' ) ).toBeInTheDocument();
		expect( screen.queryByText( '/annotate' ) ).not.toBeInTheDocument();
	} );
} );
