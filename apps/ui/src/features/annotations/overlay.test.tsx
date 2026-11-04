import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AnnotationOverlay } from './overlay';
import {
	changeAnnotation,
	getSiteAnnotations,
	pickAnnotation,
	removeAnnotations,
	setAnnotating,
	stageAnnotations,
} from './store';
import type { ComposerImageAttachment } from '@studio/agent/protocol/composer-attachments';

const SITE = 'one';

afterEach( () => {
	removeAnnotations(
		SITE,
		getSiteAnnotations( SITE ).notes.map( ( note ) => note.id )
	);
	setAnnotating( SITE, false );
} );

async function setup( anchor: { left: number; top: number } | null = { left: 20, top: 20 } ) {
	const { connector } = renderWithProviders(
		<AnnotationOverlay siteId={ SITE } anchor={ anchor } onSend={ vi.fn() } />
	);
	await waitFor( () =>
		expect( document.querySelector( '[data-annotation-overlay]' ) ).not.toBeNull()
	);
	return connector;
}

const annotate = () => act( () => setAnnotating( SITE, true ) );
const pick = () =>
	act( () => {
		pickAnnotation( SITE, { selector: 'h1', tag: 'h1', path: '/' } );
	} );

const image = ( id: string ): ComposerImageAttachment => ( {
	id,
	kind: 'image',
	name: `${ id }.png`,
	mimeType: 'image/png',
	size: 1,
	dataBase64: 'eA==',
} );

describe( 'AnnotationOverlay', () => {
	it( 'keeps delete available for empty and started annotations', async () => {
		await setup();
		annotate();
		pick();
		expect( screen.getByRole( 'button', { name: 'Delete annotation' } ) ).toBeVisible();
		const input = screen.getByRole( 'textbox', { name: 'Describe the change' } );
		fireEvent.change( input, { target: { value: 'Change this heading' } } );
		expect( screen.getByRole( 'button', { name: 'Delete annotation' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Delete annotation' } ) );
		expect(
			screen.queryByRole( 'textbox', { name: 'Describe the change' } )
		).not.toBeInTheDocument();
	} );

	it.each( [ false, true ] )(
		'uses Enter to add and primary Enter to send while batching (%s)',
		async ( send ) => {
			const onSend = vi.fn();
			const connector = createFakeConnector( { preferences: { batchAnnotations: true } } );
			renderWithProviders(
				<AnnotationOverlay siteId={ SITE } anchor={ { left: 40, top: 40 } } onSend={ onSend } />,
				{ connector }
			);
			await waitFor( () => expect( connector.getUserPreferences ).toHaveBeenCalled() );
			await act( async () => {} );
			annotate();
			pick();
			const input = screen.getByRole( 'textbox', { name: 'Describe the change' } );
			fireEvent.change( input, { target: { value: 'Change this heading' } } );
			fireEvent.keyDown( input, { key: 'Enter', ctrlKey: send } );
			if ( send ) expect( onSend ).toHaveBeenCalledOnce();
			else {
				expect( onSend ).not.toHaveBeenCalled();
				expect( getSiteAnnotations( SITE ).notes[ 0 ].staged ).toBe( true );
			}
		}
	);

	it.each( [
		{ name: 'top edge', anchor: { left: 24, top: 24 }, height: 120 },
		{ name: 'bottom edge', anchor: { left: 376, top: 276 }, height: 120 },
		{
			name: 'limited space',
			anchor: { left: 200, top: 150 },
			height: 240,
		},
	] )( 'keeps the editor clear of the marker at the $name', async ( { anchor, height } ) => {
		const viewport = { width: 400, height: 300 };
		const editorWidth = 320;
		const dimensions = [
			vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockReturnValue( viewport.width ),
			vi.spyOn( HTMLElement.prototype, 'clientHeight', 'get' ).mockReturnValue( viewport.height ),
			vi.spyOn( HTMLElement.prototype, 'offsetWidth', 'get' ).mockReturnValue( editorWidth ),
			vi.spyOn( HTMLElement.prototype, 'offsetHeight', 'get' ).mockReturnValue( height ),
			vi.spyOn( HTMLElement.prototype, 'scrollHeight', 'get' ).mockReturnValue( height ),
		];
		try {
			await setup( anchor );
			annotate();
			pick();
			const editor = await screen.findByRole( 'group', { name: 'Annotation' } );
			const top = parseFloat( editor.style.top );
			const left = parseFloat( editor.style.left );
			const maxHeight = parseFloat( editor.style.maxHeight );
			const bottom = top + Math.min( height, maxHeight );
			expect( maxHeight ).toBeGreaterThan( 0 );
			expect( top ).toBeGreaterThanOrEqual( 0 );
			expect( left ).toBeGreaterThanOrEqual( 0 );
			expect( left + editorWidth ).toBeLessThanOrEqual( viewport.width );
			expect( top >= anchor.top + 18 || bottom <= anchor.top - 18 ).toBe( true );
			expect( bottom ).toBeLessThanOrEqual( viewport.height );
		} finally {
			dimensions.forEach( ( dimension ) => dimension.mockRestore() );
		}
	} );

	it( 'leaves annotation mode with Escape while a notification is visible', async () => {
		await setup();
		render( <div role="dialog" aria-modal="false" data-slot="toast" /> );
		annotate();
		pick();
		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Describe the change' } ), {
			key: 'Escape',
		} );
		expect(
			screen.queryByRole( 'textbox', { name: 'Describe the change' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'toolbar', { name: 'Annotations' } ) ).not.toBeInTheDocument();
	} );

	it( 'leaves the annotation open for Escape in a dialog and ignores closed dialogs', async () => {
		await setup();
		annotate();
		pick();
		const dialog = render( <div role="dialog" data-slot="dialog-content" /> );
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		expect( screen.getByRole( 'textbox', { name: 'Describe the change' } ) ).toBeInTheDocument();
		dialog.rerender( <div role="dialog" data-slot="dialog-content" data-closed="" /> );
		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Describe the change' } ), {
			key: 'Escape',
		} );
		expect(
			screen.queryByRole( 'textbox', { name: 'Describe the change' } )
		).not.toBeInTheDocument();
	} );

	describe( 'images', () => {
		function editNote( otherImages: ComposerImageAttachment[] = [] ) {
			let editing = '';
			act( () => {
				setAnnotating( SITE, true );
				if ( otherImages.length ) {
					const other = pickAnnotation( SITE, { selector: 'p' } )!;
					changeAnnotation( SITE, other, { images: otherImages } );
					stageAnnotations( SITE );
				}
				editing = pickAnnotation( SITE, { selector: 'h1' } )!;
			} );
			return () =>
				getSiteAnnotations( SITE ).notes.find( ( note ) => note.id === editing )?.images ?? [];
		}
		const upload = ( files: File[] ) =>
			fireEvent.change( document.querySelector( 'input[type="file"]' )!, { target: { files } } );

		it( 'keeps drop feedback across child elements, attaches the dropped image, and removes it', async () => {
			const images = editNote();
			await setup();
			const editor = screen.getByRole( 'group', { name: 'Annotation' } );
			const input = screen.getByRole( 'textbox', { name: 'Describe the change' } );
			const dataTransfer = {
				types: [ 'Files' ],
				files: [ new File( [ 'x' ], 'dropped.png', { type: 'image/png' } ) ],
			};
			fireEvent.dragEnter( editor, { dataTransfer } );
			expect( screen.getByText( 'Drop to attach' ) ).toBeInTheDocument();
			fireEvent.dragEnter( input, { dataTransfer } );
			fireEvent.dragLeave( editor, { dataTransfer } );
			expect( screen.getByText( 'Drop to attach' ) ).toBeInTheDocument();
			fireEvent.drop( input, { dataTransfer } );
			expect( screen.queryByText( 'Drop to attach' ) ).not.toBeInTheDocument();
			await waitFor( () =>
				expect( images().map( ( item ) => item.name ) ).toEqual( [ 'dropped.png' ] )
			);
			fireEvent.click( screen.getByRole( 'button', { name: 'Remove attachment' } ) );
			await waitFor( () => expect( images() ).toHaveLength( 0 ) );
			expect( input ).toBeInTheDocument();
			fireEvent.dragEnter( editor, { dataTransfer } );
			expect( screen.getByText( 'Drop to attach' ) ).toBeInTheDocument();
			fireEvent.dragEnd( window );
			expect( screen.queryByText( 'Drop to attach' ) ).not.toBeInTheDocument();
		} );

		it( 'counts the other notes’ images against the message’s image limit', async () => {
			const images = editNote( [ 'a', 'b', 'c' ].map( image ) );
			await setup( { left: 10, top: 10 } );
			upload( [
				new File( [ 'x' ], 'four.png', { type: 'image/png' } ),
				new File( [ 'x' ], 'five.png', { type: 'image/png' } ),
			] );
			await waitFor( () =>
				expect( images().map( ( item ) => item.name ) ).toEqual( [ 'four.png' ] )
			);
			expect( getVisibleToasts().map( ( toast ) => toast.title ) ).toContain(
				'You can attach up to 4 images'
			);
		} );

		it( 'rejects unsupported images instead of attaching them as filesystem paths', async () => {
			const images = editNote();
			const connector = await setup( { left: 10, top: 10 } );
			upload( [ new File( [ '<svg />' ], 'reference.svg', { type: 'image/svg+xml' } ) ] );
			await act( async () => {} );
			expect( images() ).toHaveLength( 0 );
			expect( connector.getFilePath ).not.toHaveBeenCalled();
		} );
	} );

	it( 'leaves staged annotation actions in the header without a bottom toolbar', async () => {
		act( () => {
			setAnnotating( SITE, true );
			const id = pickAnnotation( SITE, { selector: 'h1' } )!;
			changeAnnotation( SITE, id, { comment: 'Make the heading smaller' } );
			stageAnnotations( SITE );
		} );
		await setup( null );
		expect( screen.queryByRole( 'toolbar' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: /^Send/ } ) ).not.toBeInTheDocument();
		expect( getSiteAnnotations( SITE ).notes[ 0 ].staged ).toBe( true );
	} );
} );
