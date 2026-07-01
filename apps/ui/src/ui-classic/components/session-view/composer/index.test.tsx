import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	act,
	createEvent,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerHandle } from '.';
import type { ComposerSendAttachments } from './use-composer-attachments';
import type { ComponentProps } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		createSession: vi.fn(),
		getFilePath: vi.fn( ( file: File ) => `/tmp/studio-attachments/${ file.name }` ),
		setSessionModel: vi.fn(),
	} ),
} ) );

const defaultProps = {
	busy: false,
	error: null,
	model: DEFAULT_MODEL,
	onSend: vi.fn< ( prompt: string, attachments?: ComposerSendAttachments ) => Promise< void > >(),
	onInterrupt: vi.fn< () => Promise< void > >(),
	entries: [],
};

function renderComposer( props: Partial< ComponentProps< typeof Composer > > = {} ) {
	return render(
		<QueryClientProvider client={ new QueryClient() }>
			<Tooltip.Provider delay={ 0 }>
				<Composer { ...defaultProps } sessionId="session-1" { ...props } />
			</Tooltip.Provider>
		</QueryClientProvider>
	);
}

function firePointerEventWithClientY( element: Element, type: string, clientY: number ) {
	const event = createEvent( type, element, { bubbles: true } );
	Object.defineProperties( event, {
		button: { value: 0 },
		clientY: { value: clientY },
		pointerId: { value: 1 },
		pointerType: { value: 'mouse' },
	} );
	fireEvent( element, event );
}

describe( 'Composer menu', () => {
	it( 'shows tooltips for the plus button and model picker', async () => {
		renderComposer();

		fireEvent.pointerEnter( screen.getByRole( 'button', { name: 'Add skill or attachment' } ) );
		fireEvent.mouseEnter( screen.getByRole( 'button', { name: 'Add skill or attachment' } ) );
		expect( await screen.findByText( 'Add skill or attachment' ) ).toBeInTheDocument();

		fireEvent.pointerLeave( screen.getByRole( 'button', { name: 'Add skill or attachment' } ) );
		fireEvent.mouseLeave( screen.getByRole( 'button', { name: 'Add skill or attachment' } ) );
		await waitFor( () => {
			expect( screen.queryByText( 'Add skill or attachment' ) ).not.toBeInTheDocument();
		} );

		fireEvent.pointerEnter( screen.getByRole( 'button', { name: 'Select model' } ) );
		fireEvent.mouseEnter( screen.getByRole( 'button', { name: 'Select model' } ) );
		expect( await screen.findByText( 'Select model' ) ).toBeInTheDocument();
	} );

	it( 'shows a tooltip for the stop button while busy', async () => {
		renderComposer( { busy: true } );

		fireEvent.pointerEnter( screen.getByRole( 'button', { name: 'Stop' } ) );
		fireEvent.mouseEnter( screen.getByRole( 'button', { name: 'Stop' } ) );

		expect( await screen.findByText( 'Stop' ) ).toBeInTheDocument();
	} );

	it( 'uses a queue-focused placeholder while busy', () => {
		renderComposer( { busy: true } );

		expect( screen.getByText( 'Queue the next message while I work…' ) ).toBeInTheDocument();
		expect(
			screen.getByPlaceholderText( 'Queue the next message while I work…' )
		).toBeInTheDocument();
	} );

	it( 'shows a flyout affordance and skill descriptions', async () => {
		renderComposer();

		fireEvent.click( screen.getByRole( 'button', { name: 'Add skill or attachment' } ) );

		const skillsItem = await screen.findByRole( 'menuitem', { name: /Skills/ } );
		expect( within( skillsItem ).getByText( 'Skills' ) ).toBeInTheDocument();
		expect( skillsItem.querySelector( 'svg' ) ).toBeInTheDocument();

		fireEvent.pointerMove( skillsItem );
		fireEvent.mouseEnter( skillsItem );
		fireEvent.keyDown( skillsItem, { key: 'ArrowRight' } );

		await waitFor( () => {
			expect( screen.getByText( AI_SKILL_COMMANDS[ 0 ].description ) ).toBeInTheDocument();
		} );
	} );

	it( 'portals attachment hover previews to the document body', async () => {
		const { container } = renderComposer();
		const textFile = new File( [ 'Attachment preview text' ], 'notes.txt', {
			type: 'text/plain',
		} );
		const input = container.querySelector( 'input[type="file"]' ) as HTMLInputElement;

		fireEvent.change( input, {
			target: { files: [ textFile ] },
		} );

		const removeButton = await screen.findByRole( 'button', {
			name: 'Remove attachment: notes.txt',
		} );
		const attachmentItem = removeButton.closest( 'li' );
		expect( attachmentItem ).toBeInTheDocument();
		vi.spyOn( attachmentItem!, 'getBoundingClientRect' ).mockReturnValue( {
			x: 180,
			y: 420,
			top: 420,
			right: 236,
			bottom: 476,
			left: 180,
			width: 56,
			height: 56,
			toJSON: () => ( {} ),
		} );

		fireEvent.pointerEnter( attachmentItem! );

		const preview = await screen.findByRole( 'tooltip' );
		expect( preview ).toHaveTextContent( 'notes.txt' );
		expect( preview.parentElement ).toBe( document.body );
	} );

	it( 'adds image files through the imperative handle and focuses the textbox', async () => {
		const ref = createRef< ComposerHandle >();
		renderComposer( { ref } );
		const screenshot = new File( [ new Uint8Array( [ 1, 2, 3 ] ) ], 'screenshot.jpg', {
			type: 'image/jpeg',
		} );

		await act( async () => {
			await expect( ref.current?.addFiles( [ screenshot ] ) ).resolves.toBe( true );
		} );

		expect(
			await screen.findByRole( 'button', { name: 'Remove attachment: screenshot.jpg' } )
		).toBeInTheDocument();
		await waitFor( () => expect( screen.getByRole( 'textbox' ) ).toHaveFocus() );
	} );

	it( 'adds path-based file attachments through the imperative handle', async () => {
		const ref = createRef< ComposerHandle >();
		renderComposer( { ref } );

		act( () => {
			expect(
				ref.current?.addFileAttachments( [
					{
						id: 'console-log',
						name: 'browser-console.txt',
						path: '/tmp/studio-attachments/browser-console.txt',
						mimeType: 'text/plain',
						size: 123,
					},
				] )
			).toBe( true );
		} );

		expect(
			await screen.findByRole( 'button', { name: 'Remove attachment: browser-console.txt' } )
		).toBeInTheDocument();
		await waitFor( () => expect( screen.getByRole( 'textbox' ) ).toHaveFocus() );
	} );

	it( 'grows, clamps, and shrinks the textarea with draft content', async () => {
		Object.defineProperty( window, 'innerHeight', {
			configurable: true,
			value: 1000,
		} );
		renderComposer();
		const textarea = screen.getByRole( 'textbox' ) as HTMLTextAreaElement;
		let scrollHeight = 72;
		Object.defineProperty( textarea, 'scrollHeight', {
			configurable: true,
			get: () => scrollHeight,
		} );

		fireEvent.change( textarea, {
			target: { value: 'Line one\nLine two\nLine three' },
		} );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '72px' } );
			expect( textarea ).toHaveStyle( { overflowY: 'hidden' } );
		} );

		scrollHeight = 420;
		fireEvent.change( textarea, {
			target: {
				value: Array.from( { length: 20 }, ( _, index ) => `Line ${ index + 1 }` ).join( '\n' ),
			},
		} );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '320px' } );
			expect( textarea ).toHaveStyle( { overflowY: 'auto' } );
		} );

		scrollHeight = 36;
		fireEvent.change( textarea, {
			target: { value: 'Short again' },
		} );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '48px' } );
			expect( textarea ).toHaveStyle( { overflowY: 'hidden' } );
		} );
	} );

	it( 'resizes the textarea by dragging the composer top edge', async () => {
		Object.defineProperty( window, 'innerHeight', {
			configurable: true,
			value: 1000,
		} );
		renderComposer();
		const textarea = screen.getByRole( 'textbox' ) as HTMLTextAreaElement;
		const resizeHandle = screen.getByRole( 'separator', { name: 'Resize composer' } );
		Object.defineProperty( textarea, 'scrollHeight', {
			configurable: true,
			get: () => 240,
		} );
		vi.spyOn( textarea, 'getBoundingClientRect' ).mockReturnValue( {
			x: 0,
			y: 0,
			top: 0,
			right: 760,
			bottom: 120,
			left: 0,
			width: 760,
			height: 120,
			toJSON: () => ( {} ),
		} );

		firePointerEventWithClientY( resizeHandle, 'pointerdown', 500 );
		firePointerEventWithClientY( resizeHandle, 'pointermove', 420 );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '200px' } );
			expect( resizeHandle ).toHaveAttribute( 'aria-valuenow', '200' );
		} );

		firePointerEventWithClientY( resizeHandle, 'pointermove', 620 );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '48px' } );
			expect( resizeHandle ).toHaveAttribute( 'aria-valuenow', '48' );
		} );

		firePointerEventWithClientY( resizeHandle, 'pointerup', 620 );
	} );
} );
