import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { getAiSkillCommands } from '@studio/common/ai/slash-commands';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { createRef, useState, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import {
	changeAnnotation,
	getSiteAnnotations,
	pickAnnotation,
	removeAnnotations,
	stageAnnotations,
} from '@/features/annotations';
import { Composer, type ComposerHandle } from '@/features/composer';
import { createFakeConnector, type FakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { clearComposerDrafts, getComposerDraft, saveComposerDraft } from './draft-store';
import type { ComposerImageAttachment } from '@studio/common/ai/composer-attachments';

type Props = Partial< ComponentProps< typeof Composer > > & { ref?: React.Ref< ComposerHandle > };

const SITE = 'composer-site';
const interrupt = vi.fn( async () => {} );

async function setup( props: Props = {}, connector: FakeConnector = createFakeConnector() ) {
	const onSend = props.onSend ?? vi.fn( async () => {} );
	const view = renderWithProviders(
		<Composer
			busy={ false }
			model="balanced"
			sessionId="test"
			onSend={ onSend }
			onInterrupt={ interrupt }
			entries={ [] }
			{ ...props }
		/>,
		{ connector }
	);
	const input = ( await screen.findByRole( 'combobox', {
		name: /WordPress Studio/,
	} ) ) as HTMLTextAreaElement;
	return { ...view, input, onSend };
}

const upload = ( name: string ) =>
	fireEvent.change( screen.getByLabelText( 'Upload attachments' ), {
		target: { files: [ new File( [ name ], name, { type: 'text/plain' } ) ] },
	} );

async function chooseSkill() {
	fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
	expect( await screen.findAllByRole( 'listbox' ) ).toHaveLength( 1 );
	expect( screen.queryByRole( 'option', { name: 'Skills' } ) ).not.toBeInTheDocument();
	for ( const command of getAiSkillCommands() ) {
		expect(
			await screen.findByRole( 'option', {
				name: `${ command.displayName } ${ command.description }`,
			} )
		).toBeVisible();
	}
	fireEvent.click( screen.getByRole( 'option', { name: /^Visual Annotations / } ) );
}

function stageNote( comment: string, images: ComposerImageAttachment[] = [] ) {
	const id = pickAnnotation( SITE, { tag: 'h1', selector: 'h1', path: '/' } )!;
	changeAnnotation( SITE, id, { comment, images } );
	stageAnnotations( SITE );
	return id;
}

const image = ( id: string, size = 1 ): ComposerImageAttachment => ( {
	id,
	kind: 'image',
	name: `${ id }.png`,
	mimeType: 'image/png',
	size,
	dataBase64: 'eA==',
} );

const errorToasts = () =>
	getVisibleToasts()
		.filter( ( toast ) => toast.intent === 'error' )
		.map( ( toast ) => toast.title );

beforeEach( () => {
	clearComposerDrafts();
	removeAnnotations(
		SITE,
		getSiteAnnotations( SITE ).notes.map( ( note ) => note.id )
	);
	vi.clearAllMocks();
} );

describe( 'Chat composer', () => {
	it( 'preserves edits and new attachments while a send is accepted', async () => {
		let resolve!: () => void;
		const onSend = vi.fn(
			() =>
				new Promise< void >( ( accept ) => {
					resolve = accept;
				} )
		);
		const { input } = await setup( { onSend } );
		fireEvent.change( input, { target: { value: 'First message' } } );
		upload( 'first.txt' );
		await screen.findByText( 'first.txt' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( onSend ).toHaveBeenCalled() );
		expect( input ).toHaveValue( '' );
		fireEvent.change( input, { target: { value: 'New draft' } } );
		upload( 'second.txt' );
		await screen.findByText( 'second.txt' );
		await act( async () => resolve() );
		expect( input ).toHaveValue( 'New draft' );
		expect( screen.getByText( 'second.txt' ) ).toBeVisible();
		expect( screen.queryByText( 'first.txt' ) ).not.toBeInTheDocument();
		expect( getComposerDraft( 'test' ).text ).toBe( 'New draft' );
	} );

	it( 'keeps Stop available while the submitted draft waits for acknowledgement', async () => {
		let resolve!: () => void;
		const onSend = vi.fn(
			() =>
				new Promise< void >( ( accept ) => {
					resolve = accept;
				} )
		);
		const { input } = await setup( { busy: true, onSend } );
		fireEvent.change( input, { target: { value: 'Pending message' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue message' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Stop response' } ) );
		expect( interrupt ).toHaveBeenCalledOnce();
		await act( async () => resolve() );
	} );

	it( 'clears an accepted draft even after leaving the chat', async () => {
		let resolve!: () => void;
		const onSend = vi.fn(
			() =>
				new Promise< void >( ( accept ) => {
					resolve = accept;
				} )
		);
		const { input, unmount } = await setup( { onSend } );
		fireEvent.change( input, { target: { value: 'Send and leave' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( onSend ).toHaveBeenCalled() );
		unmount();
		await act( async () => resolve() );
		expect( getComposerDraft( 'test' ).text ).toBe( '' );
	} );

	it( 'preserves a new draft when an earlier send fails', async () => {
		let rejectSend!: ( error: Error ) => void;
		const onSend = vi.fn(
			() =>
				new Promise< void >( ( _resolve, reject ) => {
					rejectSend = reject;
				} )
		);
		const { input } = await setup( { onSend } );
		fireEvent.change( input, { target: { value: 'First message' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( onSend ).toHaveBeenCalled() );
		expect( input ).toBeEnabled();
		fireEvent.change( input, { target: { value: 'New draft written while waiting' } } );
		await act( async () => rejectSend( new Error( 'Connection lost' ) ) );
		expect( input ).toHaveValue( 'New draft written while waiting' );
	} );

	it( 'pastes files into the composer above the text without replacing the draft', async () => {
		const { input } = await setup();
		fireEvent.change( input, { target: { value: 'Keep this prompt' } } );
		const file = new File( [ 'pasted notes' ], 'pasted.txt', { type: 'text/plain' } );
		fireEvent.paste( input, {
			clipboardData: {
				items: [ { kind: 'file', type: 'text/plain', getAsFile: () => file } ],
				files: [ file ],
			},
		} );
		const attachment = await screen.findByRole( 'listitem', { name: /^pasted.txt,/ } );
		expect( input.closest( '[data-slot="input-group"]' ) ).toContainElement( attachment );
		expect( input ).toHaveValue( 'Keep this prompt' );
	} );

	it.each( [ 'menu', 'slash' ] )(
		'opens the model picker through %s without sending or losing the draft',
		async ( source ) => {
			const { input, onSend } = await setup();
			await waitFor( () =>
				expect( screen.getByRole( 'button', { name: 'Model' } ) ).toBeEnabled()
			);
			fireEvent.change( input, {
				target: { value: source === 'slash' ? 'Keep this draft /mod' : 'Keep this draft' },
			} );
			if ( source === 'slash' ) {
				fireEvent.keyDown( input, { key: 'Enter' } );
			} else {
				fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
				fireEvent.click( await screen.findByRole( 'option', { name: /^Choose model/ } ) );
			}
			await waitFor( () =>
				expect( screen.getByRole( 'button', { name: 'Model' } ) ).toHaveAttribute(
					'aria-expanded',
					'true'
				)
			);
			expect( input ).toHaveValue( source === 'slash' ? 'Keep this draft ' : 'Keep this draft' );
			expect( onSend ).not.toHaveBeenCalled();
		}
	);

	it( 'hides the model command when model selection is unavailable', async () => {
		await setup( {}, createFakeConnector( { user: null } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		await screen.findByRole( 'option', { name: 'Add files' } );
		expect( screen.queryByRole( 'option', { name: /^Choose model/ } ) ).not.toBeInTheDocument();
	} );

	it( 'opens provider settings from the add menu without changing or sending the draft', async () => {
		const { input, onSend, history } = await setup();
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /^Connect AI providers/ } ) );
		await waitFor( () => expect( history.location.search ).toContain( 'settings=ai' ) );
		expect( input ).toHaveValue( 'Keep this draft' );
		expect( onSend ).not.toHaveBeenCalled();
		await waitFor( () => expect( screen.queryByRole( 'listbox' ) ).not.toBeInTheDocument() );
	} );

	it( 'emphasizes provider setup on submit without losing text, attachments, or focus', async () => {
		const { input, onSend } = await setup( {
			notice: { message: 'Connect a provider', action: { label: 'Connect', onClick: vi.fn() } },
		} );
		upload( 'notes.txt' );
		await screen.findByText( 'notes.txt' );
		const notice = screen.getByText( 'Connect a provider' ).closest( '[role="alert"]' )!;
		const send = screen.getByRole( 'button', { name: 'Send message' } );
		expect( send ).toBeEnabled();
		expect( notice ).not.toHaveAttribute( 'data-feedback' );
		fireEvent.change( input, { target: { value: 'Keep this draft' } } );
		input.focus();
		vi.useFakeTimers();
		try {
			fireEvent.keyDown( input, { key: 'Enter' } );
			expect( notice ).toHaveAttribute( 'data-feedback', 'shake' );
			expect( send ).toHaveAttribute( 'data-variant', 'destructive' );
			await act( () => vi.advanceTimersByTime( 120 ) );
			fireEvent.click( send );
			await act( () => vi.advanceTimersByTime( 120 ) );
			expect( notice ).toHaveAttribute( 'data-feedback', 'error' );
			fireEvent.click( send );
			expect( notice ).toHaveAttribute( 'data-feedback', 'shake' );
			await act( () => vi.advanceTimersByTime( 240 ) );
			await act( () => vi.advanceTimersByTime( 660 ) );
			expect( send ).toHaveAttribute( 'data-variant', 'accent' );
			expect( notice ).not.toHaveAttribute( 'data-feedback' );
			expect( input ).toHaveFocus();
			expect( input ).toHaveValue( 'Keep this draft' );
			expect( screen.getByText( 'notes.txt' ) ).toBeVisible();
			expect( onSend ).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'clears provider feedback after setup and sends only on a new attempt', async () => {
		const onSend = vi.fn( async () => {} );
		function ConnectedComposer() {
			const [ connected, setConnected ] = useState( false );
			return (
				<Composer
					busy={ false }
					model={ DEFAULT_MODEL }
					sessionId="connect-test"
					onSend={ onSend }
					onInterrupt={ interrupt }
					notice={
						connected
							? undefined
							: {
									message: 'Connect a provider',
									action: { label: 'Connect', onClick: () => setConnected( true ) },
							  }
					}
				/>
			);
		}
		renderWithProviders( <ConnectedComposer /> );
		const input = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
		fireEvent.change( input, { target: { value: 'Build a homepage' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( screen.getByText( 'Connect a provider' ).closest( '[role="alert"]' ) ).toHaveAttribute(
			'data-feedback',
			'shake'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Connect' } ) );
		expect( screen.queryByText( 'Connect a provider' ) ).not.toBeInTheDocument();
		expect( input ).toHaveValue( 'Build a homepage' );
		expect( onSend ).not.toHaveBeenCalled();
		fireEvent.keyDown( input, { key: 'Enter' } );
		await waitFor( () =>
			expect( onSend ).toHaveBeenCalledExactlyOnceWith( 'Build a homepage', {
				files: [],
				images: [],
			} )
		);
	} );

	it.each( [ 'Starting Local example', 'Stopping Local example' ] )(
		'keeps the "%s" placeholder clickable and hides its shimmer when typing',
		async ( label ) => {
			const { input } = await setup( { placeholder: label, placeholderBusy: true } );
			expect( input ).toHaveAttribute( 'placeholder', label );
			expect( input ).toBeEnabled();
			expect( screen.getByText( label ) ).toHaveClass( 'studio-shimmer' );
			input.focus();
			expect( input ).toHaveFocus();
			fireEvent.change( input, { target: { value: 'Build a homepage' } } );
			expect( input ).toHaveValue( 'Build a homepage' );
			expect( screen.queryByText( label ) ).not.toBeInTheDocument();
		}
	);

	it.each( [ 'menu', 'slash' ] )( 'inserts a skill using %s without sending', async ( source ) => {
		const { input, onSend } = await setup();
		fireEvent.change( input, { target: { value: 'Please /ann' } } );
		if ( source === 'menu' ) {
			await chooseSkill();
		} else {
			fireEvent.keyDown( input, { key: 'Enter' } );
		}
		expect( input ).toHaveValue( 'Please /annotate ' );
		await waitFor( () => expect( input ).toHaveFocus() );
		expect( input.selectionStart ).toBe( 'Please /annotate '.length );
		expect( onSend ).not.toHaveBeenCalled();
		await waitFor( () => expect( screen.queryByRole( 'listbox' ) ).not.toBeInTheDocument() );
	} );

	it.each( [
		{ text: '', start: 0, end: 0, expected: '/annotate ' },
		{ text: 'Please review', start: 7, end: 7, expected: 'Please /annotate review' },
		{ text: 'Please /ann review', start: 11, end: 11, expected: 'Please /annotate review' },
		{ text: 'Please replace this', start: 7, end: 14, expected: 'Please /annotate this' },
	] )(
		'preserves the draft when inserting into "$text"',
		async ( { text, start, end, expected } ) => {
			const { input, onSend } = await setup();
			fireEvent.change( input, { target: { value: text } } );
			input.setSelectionRange( start, end );
			await chooseSkill();
			expect( input ).toHaveValue( expected );
			expect( onSend ).not.toHaveBeenCalled();
		}
	);

	it( 'uses the same picker for slash typing and supports dismissal and menu navigation', async () => {
		const { input } = await setup();
		fireEvent.change( input, { target: { value: '/ann' } } );
		await screen.findByRole( 'listbox' );
		expect( screen.getByRole( 'group', { name: 'Skills' } ) ).toBeVisible();
		expect( screen.queryByRole( 'group', { name: 'Commands' } ) ).not.toBeInTheDocument();
		fireEvent.keyDown( input, { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'listbox' ) ).not.toBeInTheDocument() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		const picker = await screen.findByRole( 'listbox' );
		expect( screen.getByRole( 'group', { name: 'Skills' } ) ).toBeVisible();
		const files = screen.getByRole( 'option', { name: 'Add files' } );
		fireEvent.keyDown( picker, { key: 'Home' } );
		expect( files ).toHaveAttribute( 'aria-selected', 'true' );
	} );

	it( 'reopens autocomplete when the same slash fragment is typed again', async () => {
		const { input, onSend } = await setup();
		fireEvent.change( input, { target: { value: 'Please /ann' } } );
		await chooseSkill();
		fireEvent.change( input, { target: { value: 'Please /ann' } } );
		expect( await screen.findByRole( 'listbox' ) ).toBeVisible();
		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( input ).toHaveValue( 'Please /annotate ' );
		expect( onSend ).not.toHaveBeenCalled();
	} );

	it( 'opens the multiple-file picker from the menu and attaches the selected file', async () => {
		const { onSend } = await setup();
		const fileInput = screen.getByLabelText( 'Upload attachments' ) as HTMLInputElement;
		const picker = vi.spyOn( fileInput, 'click' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Add files' } ) );
		await waitFor( () => expect( picker ).toHaveBeenCalledOnce() );
		expect( fileInput.multiple ).toBe( true );
		fireEvent.change( fileInput, {
			target: { files: [ new File( [ 'Notes' ], 'notes.txt', { type: 'text/plain' } ) ] },
		} );
		expect( await screen.findByText( 'notes.txt' ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () =>
			expect( onSend ).toHaveBeenCalledWith(
				'Please review the attached files.',
				expect.objectContaining( { files: [ expect.objectContaining( { name: 'notes.txt' } ) ] } )
			)
		);
	} );

	it( 'keeps Enter submission, Shift+Enter and IME composition behavior', async () => {
		const { input, onSend } = await setup();
		fireEvent.change( input, { target: { value: 'Hello' } } );
		fireEvent.keyDown( input, { key: 'Enter', shiftKey: true } );
		fireEvent.keyDown( input, { key: 'Enter', isComposing: true } );
		expect( onSend ).not.toHaveBeenCalled();
		fireEvent.keyDown( input, { key: 'Enter' } );
		await waitFor( () => expect( onSend ).toHaveBeenCalledOnce() );
		await waitFor( () => expect( input ).toHaveValue( '' ) );
	} );

	it( 'preserves queueing and stopping during an active run', async () => {
		const { input, onSend } = await setup( { busy: true } );
		expect( screen.getByRole( 'button', { name: 'Stop response' } ) ).toBeEnabled();
		expect( screen.queryByRole( 'button', { name: 'Queue message' } ) ).not.toBeInTheDocument();
		fireEvent.change( input, { target: { value: 'Follow up' } } );
		expect( screen.queryByRole( 'button', { name: 'Stop response' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue message' } ) );
		await waitFor( () => expect( onSend ).toHaveBeenCalledOnce() );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Stop response' } ) );
		expect( interrupt ).toHaveBeenCalledOnce();
	} );

	it( 'keeps force stop available with an empty input', async () => {
		const { input, onSend } = await setup( { busy: true, isInterrupting: true } );
		fireEvent.change( input, { target: { value: '   ' } } );
		const stop = screen.getByRole( 'button', { name: 'Force stop' } );
		expect( stop ).toBeEnabled();
		expect( stop ).toHaveAttribute( 'type', 'button' );
		fireEvent.click( stop );
		expect( interrupt ).toHaveBeenCalledOnce();
		expect( onSend ).not.toHaveBeenCalled();
	} );

	it.each( [ false, true ] )(
		'answers a pending question without submitting a prompt (auto-start=%s)',
		async ( enabled ) => {
			const onAnswer = vi.fn();
			const { input, onSend } = await setup(
				{ onAnswer, canAutoStart: true },
				createFakeConnector( {
					preferences: { autoStartSiteOnChat: enabled } as never,
				} )
			);
			expect( input ).toHaveAttribute( 'placeholder', 'Your answer' );
			fireEvent.change( input, { target: { value: 'Blue' } } );
			fireEvent.click( screen.getByRole( 'button', { name: 'Send answer' } ) );
			expect( onAnswer ).toHaveBeenCalledWith( 'Blue' );
			expect( onSend ).not.toHaveBeenCalled();
		}
	);
} );

describe( 'Composer parity', () => {
	const liveUrl = 'https://example.com';

	it( 'hides Auto-start while its chip is active and restores the command after removal', async () => {
		const { input, onSend } = await setup( { canAutoStart: true } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		const option = await screen.findByRole( 'option', { name: /^Auto-start / } );
		await waitFor( () => expect( option ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
		fireEvent.click( option );
		await screen.findByRole( 'button', { name: 'Remove Auto-start' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		await screen.findByRole( 'option', { name: 'Add files' } );
		expect( screen.queryByRole( 'option', { name: /^Auto-start / } ) ).not.toBeInTheDocument();
		fireEvent.keyDown( input, { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'listbox' ) ).not.toBeInTheDocument() );
		fireEvent.change( input, { target: { value: '/auto' } } );
		expect( screen.queryByRole( 'option', { name: /^Auto-start / } ) ).not.toBeInTheDocument();
		fireEvent.change( input, { target: { value: '' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove Auto-start' } ) );
		await waitFor( () =>
			expect(
				screen.queryByRole( 'button', { name: 'Remove Auto-start' } )
			).not.toBeInTheDocument()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		expect( await screen.findByRole( 'option', { name: /^Auto-start / } ) ).not.toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( onSend ).not.toHaveBeenCalled();
	} );

	it.each( [ 'menu', 'slash' ] )(
		'changes the target through %s without sending or losing the draft',
		async ( source ) => {
			const change = vi.fn();
			const { input, onSend } = await setup( { liveUrl, onEnvironmentChange: change } );
			fireEvent.change( input, {
				target: { value: source === 'slash' ? 'Please /live' : 'Keep this draft' },
			} );
			if ( source === 'slash' ) {
				fireEvent.keyDown( input, { key: 'Enter' } );
			} else {
				fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
				fireEvent.click(
					await screen.findByRole( 'option', { name: `Work on live site ${ liveUrl }` } )
				);
			}
			expect( change ).toHaveBeenCalledWith( 'live' );
			expect( onSend ).not.toHaveBeenCalled();
			expect( input ).toHaveValue( source === 'slash' ? 'Please ' : 'Keep this draft' );
		}
	);

	it( 'shows only the active Live chip and returns to local', async () => {
		const change = vi.fn();
		await setup( { environment: 'live', liveUrl, onEnvironmentChange: change } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove Live' } ) );
		expect( change ).toHaveBeenCalledWith( 'local' );
		expect( screen.queryByRole( 'button', { name: 'Remove Auto-start' } ) ).not.toBeInTheDocument();
	} );

	it( 'restores text and files after a rejected send', async () => {
		const onSend = vi.fn().mockRejectedValue( new Error( 'Disconnected' ) );
		const { input } = await setup( { onSend } );
		fireEvent.change( input, { target: { value: 'Please read this' } } );
		upload( 'notes.txt' );
		await screen.findByText( 'notes.txt' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( onSend ).toHaveBeenCalled() );
		await waitFor( () => expect( input ).toHaveValue( 'Please read this' ) );
		expect( screen.getByText( 'notes.txt' ) ).toBeVisible();
	} );
} );

describe( 'Annotation attachments in the composer', () => {
	it( 'preserves staged notes when sending is blocked', async () => {
		const ref = createRef< ComposerHandle >();
		stageNote( 'Use note' );
		const { onSend } = await setup( {
			ref,
			annotationSiteId: SITE,
			notice: { message: 'Connect a provider' },
		} );
		await act( async () => {
			await ref.current!.send();
		} );
		expect( onSend ).not.toHaveBeenCalled();
		expect( getSiteAnnotations( SITE ).notes.filter( ( note ) => note.staged ) ).toHaveLength( 1 );
	} );

	it( 'preserves image identities across ordinary attachments and multiple annotations', async () => {
		saveComposerDraft( 'test', { text: '', attachments: [ image( 'ordinary' ) ] } );
		stageNote( 'Use first', [ image( 'first' ) ] );
		stageNote( 'Use second', [ image( 'second' ) ] );
		const { onSend } = await setup( { annotationSiteId: SITE } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( onSend ).toHaveBeenCalledOnce() );
		expect( onSend ).toHaveBeenCalledWith(
			expect.stringContaining( 'Attached images (in attachment order): 2\n' ),
			expect.objectContaining( {
				images: [ image( 'ordinary' ), image( 'first' ), image( 'second' ) ].map(
					( { kind: _kind, ...attachment } ) => attachment
				),
				visualAnnotations: [
					{ comment: '', imageIds: [ 'ordinary' ] },
					expect.objectContaining( { imageIds: [ 'first' ] } ),
					expect.objectContaining( { imageIds: [ 'second' ] } ),
				],
			} )
		);
		expect( onSend ).toHaveBeenCalledWith(
			expect.stringContaining( 'Attached images (in attachment order): 3\n' ),
			expect.anything()
		);
	} );

	it( 'validates newly added chat images against staged annotation images before sending', async () => {
		saveComposerDraft( 'test', {
			text: 'Keep my instructions',
			attachments: [ image( 'ordinary' ) ],
		} );
		stageNote( 'Full', [ image( 'a' ), image( 'b' ), image( 'c' ), image( 'd' ) ] );
		const { onSend, input } = await setup( { annotationSiteId: SITE } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		expect( onSend ).not.toHaveBeenCalled();
		expect( errorToasts() ).toContain( 'You can attach up to 4 images.' );
		expect( input ).toHaveValue( 'Keep my instructions' );
		expect( getSiteAnnotations( SITE ).notes ).toHaveLength( 1 );
		expect( getComposerDraft( 'test' ).attachments ).toHaveLength( 1 );
	} );

	it.each( [ false, true ] )(
		'restores queued files as editable attachments (remove: %s)',
		async ( remove ) => {
			const ref = createRef< ComposerHandle >();
			const { onSend } = await setup( { ref } );
			const file = {
				id: 'file',
				name: 'reference.css',
				path: '/tmp/reference.css',
				mimeType: 'text/css',
				size: 20,
			};
			act( () => ref.current!.replaceDraft( 'Queued', { files: [ file ] } ) );
			expect( screen.getByRole( 'listitem', { name: /^reference.css,/ } ) ).toBeVisible();
			if ( remove ) {
				fireEvent.click( screen.getByRole( 'button', { name: 'Remove attachment' } ) );
			}
			fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
			await waitFor( () => expect( onSend ).toHaveBeenCalledOnce() );
			expect( onSend ).toHaveBeenCalledWith(
				expect.any( String ),
				expect.objectContaining( { files: remove ? [] : [ file ] } )
			);
		}
	);

	it( 'answers the active question while preserving annotations for the next message', async () => {
		saveComposerDraft( 'test', { text: 'Keep my message', attachments: [] } );
		stageNote( 'Make the heading shorter' );
		const onAnswer = vi.fn();
		const { input, onSend } = await setup( { busy: true, onAnswer, annotationSiteId: SITE } );
		fireEvent.change( input, { target: { value: 'The page title' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send answer' } ) );
		await waitFor( () => expect( onAnswer ).toHaveBeenCalledWith( 'The page title' ) );
		expect( onSend ).not.toHaveBeenCalled();
		expect( input ).toHaveValue( '' );
		expect( screen.getByRole( 'listitem', { name: /^1 annotation,/ } ) ).toBeVisible();
		expect( getSiteAnnotations( SITE ).notes ).toHaveLength( 1 );
	} );

	it.each( [ 'annotation', 'image' ] )(
		'removes a mixed %s attachment independently',
		async ( removed ) => {
			saveComposerDraft( 'test', {
				text: 'Keep my message',
				attachments: [ image( 'ordinary' ) ],
			} );
			stageNote( 'Make the heading shorter' );
			const { input } = await setup( { annotationSiteId: SITE } );
			const groups = screen.getAllByLabelText( 'Attachments' );
			expect( groups ).toHaveLength( 1 );
			const row = within( groups[ 0 ] );
			expect( row.getByRole( 'listitem', { name: /^1 annotation,/ } ) ).toBeVisible();
			expect( row.getByRole( 'listitem', { name: /^ordinary.png,/ } ) ).toBeVisible();
			fireEvent.click(
				row.getAllByRole( 'button', { name: 'Remove attachment' } )[
					removed === 'annotation' ? 0 : 1
				]
			);
			expect( input ).toHaveValue( 'Keep my message' );
			expect( getSiteAnnotations( SITE ).notes ).toHaveLength( removed === 'annotation' ? 0 : 1 );
			expect( getComposerDraft( 'test' ).attachments ).toHaveLength( removed === 'image' ? 0 : 1 );
		}
	);

	it( 'shows annotations above the text and sends both together', async () => {
		saveComposerDraft( 'test', { text: 'Keep my message', attachments: [] } );
		stageNote( 'Make the heading shorter' );
		const { input, onSend } = await setup( { annotationSiteId: SITE } );
		expect( screen.getByRole( 'listitem', { name: /^1 annotation,/ } ) ).toBeVisible();
		expect( input ).toHaveValue( 'Keep my message' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () =>
			expect( onSend ).toHaveBeenCalledWith(
				expect.stringMatching( /^Keep my message\n\n/ ),
				expect.objectContaining( {
					visualAnnotations: [
						{ comment: 'Keep my message' },
						expect.objectContaining( { comment: 'Make the heading shorter' } ),
					],
				} )
			)
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'listitem', { name: /^1 annotation,/ } ) ).not.toBeInTheDocument()
		);
		expect( getSiteAnnotations( SITE ).notes ).toHaveLength( 0 );
	} );

	it( 'groups staged notes and removes them together without changing the text after a rejected send', async () => {
		saveComposerDraft( 'test', { text: 'Keep my message', attachments: [] } );
		stageNote( 'Make the heading shorter' );
		stageNote( 'Make the background warmer' );
		const onSend = vi.fn().mockRejectedValue( new Error( 'Disconnected' ) );
		const { input } = await setup( { onSend, annotationSiteId: SITE } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( onSend ).toHaveBeenCalled() );
		expect( screen.getByRole( 'listitem', { name: /^2 annotations,/ } ) ).toBeVisible();
		expect( screen.getAllByRole( 'button', { name: 'Remove attachment' } ) ).toHaveLength( 1 );
		expect( onSend ).toHaveBeenCalledWith(
			expect.stringContaining( 'Make the background warmer' ),
			expect.objectContaining( {
				visualAnnotations: [
					{ comment: 'Keep my message' },
					expect.objectContaining( { comment: 'Make the heading shorter' } ),
					expect.objectContaining( { comment: 'Make the background warmer' } ),
				],
			} )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove attachment' } ) );
		expect( input ).toHaveValue( 'Keep my message' );
		expect( screen.queryByRole( 'listitem', { name: /^2 annotations,/ } ) ).not.toBeInTheDocument();
		expect( getSiteAnnotations( SITE ).notes ).toHaveLength( 0 );
	} );
} );
