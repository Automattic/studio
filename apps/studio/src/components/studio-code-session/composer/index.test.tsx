import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSessionDraft, Composer } from '.';
import type { ComposerSendAttachments } from './use-composer-attachments';

const mockGetPathForFile = vi.hoisted( () =>
	vi.fn( ( file: File ) => `/tmp/studio-attachments/${ file.name }` )
);

vi.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( { isAuthenticated: false } ),
} ) );
vi.mock( 'src/stores/wpcom-api', () => ( {
	useGetStudioAssistantQuota: () => ( { data: undefined } ),
} ) );
vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getPathForFile: mockGetPathForFile,
		setAiSessionModel: vi.fn(),
		createAiSession: vi.fn(),
		getAiSettings: vi.fn().mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} ),
	} ),
} ) );

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
		mockGetPathForFile.mockClear();
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

	it( 'attaches pasted images and sends them with the prompt', async () => {
		renderComposer();

		const image = new File( [ 'image-bytes' ], '', { type: 'image/png' } );
		const pasteEvent = new Event( 'paste', { bubbles: true, cancelable: true } );
		Object.defineProperty( pasteEvent, 'clipboardData', {
			value: {
				files: [ image ],
				items: [],
				getData: ( type: string ) => ( type === 'text/plain' ? 'caption' : '' ),
			},
		} );
		fireEvent( screen.getByRole( 'combobox' ), pasteEvent );

		expect( pasteEvent.defaultPrevented ).toBe( true );
		expect(
			await screen.findByRole( 'button', { name: 'Remove attachment: pasted-image.png' } )
		).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Send' } ) );

		await waitFor( () => expect( defaultProps.onSend ).toHaveBeenCalled() );
		const [ prompt, attachments ] = defaultProps.onSend.mock.calls[ 0 ];
		expect( prompt ).toBe( 'Please review the attached files.' );
		expect( attachments.files ).toEqual( [] );
		expect( attachments.images ).toHaveLength( 1 );
		expect( attachments.images[ 0 ] ).toMatchObject( {
			name: 'pasted-image.png',
			mimeType: 'image/png',
			dataBase64: 'aW1hZ2UtYnl0ZXM=',
		} );
	} );

	it( 'attaches images pasted outside the textarea and focuses the composer', async () => {
		renderComposer();

		const image = new File( [ 'image-bytes' ], '', { type: 'image/png' } );
		const pasteEvent = new Event( 'paste', { bubbles: true, cancelable: true } );
		Object.defineProperty( pasteEvent, 'clipboardData', {
			value: { files: [ image ], items: [] },
		} );
		fireEvent( document.body, pasteEvent );

		expect( pasteEvent.defaultPrevented ).toBe( true );
		expect(
			await screen.findByRole( 'button', { name: 'Remove attachment: pasted-image.png' } )
		).toBeInTheDocument();
		expect( screen.getByRole( 'combobox' ) ).toHaveFocus();
	} );

	it( 'ignores pastes inside open dialogs', () => {
		renderComposer();

		const dialog = document.createElement( 'div' );
		dialog.setAttribute( 'role', 'dialog' );
		document.body.appendChild( dialog );

		const image = new File( [ 'image-bytes' ], '', { type: 'image/png' } );
		const pasteEvent = new Event( 'paste', { bubbles: true, cancelable: true } );
		Object.defineProperty( pasteEvent, 'clipboardData', {
			value: { files: [ image ], items: [] },
		} );
		fireEvent( dialog, pasteEvent );

		expect( pasteEvent.defaultPrevented ).toBe( false );
		expect( screen.queryByRole( 'button', { name: /Remove attachment/ } ) ).not.toBeInTheDocument();

		dialog.remove();
	} );

	it( 'previews attached files as compact square tiles', async () => {
		const { container } = renderComposer();

		const json = new File( [ '{\n  "headline": "Drop the needle"\n}' ], 'data-sample.json', {
			type: 'application/json',
		} );
		const pdf = new File( [ '%PDF-1.7' ], 'sample-document.pdf', {
			type: 'application/pdf',
		} );
		const input = container.querySelector( 'input[type="file"]' ) as HTMLInputElement;

		fireEvent.change( input, {
			target: { files: [ json, pdf ] },
		} );

		expect( await screen.findAllByText( /"headline"/ ) ).not.toHaveLength( 0 );
		expect( screen.getAllByText( 'PDF' ) ).not.toHaveLength( 0 );

		expect(
			screen.getByText( /Attachment: data-sample\.json, application\/json,/ )
		).toBeInTheDocument();
		const removePdfButton = screen.getByRole( 'button', {
			name: 'Remove attachment: sample-document.pdf',
		} );
		expect( removePdfButton ).toBeInTheDocument();

		fireEvent.focus( removePdfButton );
		expect( await screen.findByRole( 'tooltip' ) ).toHaveTextContent( 'sample-document.pdf' );

		fireEvent.click( screen.getByRole( 'button', { name: 'Send' } ) );

		await waitFor( () => expect( defaultProps.onSend ).toHaveBeenCalled() );
		const [ prompt, attachments ] = defaultProps.onSend.mock.calls[ 0 ];
		expect( prompt ).toBe( 'Please review the attached files.' );
		expect( attachments.images ).toEqual( [] );
		expect( attachments.files ).toEqual( [
			expect.objectContaining( {
				name: 'data-sample.json',
				path: '/tmp/studio-attachments/data-sample.json',
				mimeType: 'application/json',
			} ),
			expect.objectContaining( {
				name: 'sample-document.pdf',
				path: '/tmp/studio-attachments/sample-document.pdf',
				mimeType: 'application/pdf',
			} ),
		] );
	} );
} );
