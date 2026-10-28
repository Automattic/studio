import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { renderWithProviders } from '@/test/render';
import { AnnotationOverlay } from './overlay';
import {
	changeAnnotation,
	clearAnnotations,
	getSiteAnnotations,
	pickAnnotation,
	setAnnotating,
	stageAnnotations,
} from './store';
import type { ComposerImageAttachment } from '@studio/agent/protocol/composer-attachments';

const SITE = 'one';

afterEach( () => {
	clearAnnotations( SITE );
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
	it( 'dismisses an empty annotation with Escape while a notification is visible', async () => {
		await setup();
		render( <div role="dialog" aria-modal="false" data-slot="toast" /> );
		annotate();
		pick();
		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Leave a note' } ), { key: 'Escape' } );
		expect( screen.queryByRole( 'textbox', { name: 'Leave a note' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'toolbar', { name: 'Annotations' } ) ).toBeInTheDocument();
	} );

	it( 'leaves the annotation open for Escape in a dialog and ignores closed dialogs', async () => {
		await setup();
		annotate();
		pick();
		const dialog = render( <div role="dialog" data-slot="dialog-content" /> );
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		expect( screen.getByRole( 'textbox', { name: 'Leave a note' } ) ).toBeInTheDocument();
		dialog.rerender( <div role="dialog" data-slot="dialog-content" data-closed="" /> );
		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Leave a note' } ), { key: 'Escape' } );
		expect( screen.queryByRole( 'textbox', { name: 'Leave a note' } ) ).not.toBeInTheDocument();
	} );

	it( 'confirms discard each time and preserves notes when canceled', async () => {
		const connector = await setup();
		annotate();
		pick();
		fireEvent.change( screen.getByRole( 'textbox', { name: 'Leave a note' } ), {
			target: { value: 'Keep this draft' },
		} );
		fireEvent.click(
			within( screen.getByRole( 'toolbar' ) ).getByRole( 'button', { name: 'Cancel' } )
		);
		let dialog = await screen.findByRole( 'alertdialog', {
			name: 'Discard all pending annotations?',
		} );
		expect( within( dialog ).queryByRole( 'checkbox' ) ).not.toBeInTheDocument();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Cancel' } ) );
		expect( connector.setUserPreferences ).not.toHaveBeenCalled();
		await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
		fireEvent.click(
			within( screen.getByRole( 'toolbar' ) ).getByRole( 'button', { name: 'Cancel' } )
		);
		dialog = await screen.findByRole( 'alertdialog', { name: 'Discard all pending annotations?' } );
		expect( getSiteAnnotations( SITE ).notes[ 0 ].comment ).toBe( 'Keep this draft' );
		expect( within( dialog ).queryByRole( 'checkbox' ) ).not.toBeInTheDocument();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Discard' } ) );
		expect( connector.setUserPreferences ).not.toHaveBeenCalled();
		expect( getSiteAnnotations( SITE ).notes ).toHaveLength( 0 );
		expect( screen.queryByRole( 'toolbar' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the closing toolbar inert until reopened', async () => {
		await setup();
		annotate();
		const toolbar = screen.getByRole( 'toolbar', { name: 'Annotations' } );
		fireEvent.click( within( toolbar ).getByRole( 'button', { name: 'Cancel' } ) );
		expect( toolbar ).toBeInTheDocument();
		expect( toolbar ).toHaveAttribute( 'inert' );
		expect( screen.queryByRole( 'toolbar' ) ).not.toBeInTheDocument();
		annotate();
		expect( screen.getByRole( 'toolbar', { name: 'Annotations' } ) ).not.toHaveAttribute( 'inert' );
	} );

	describe( 'images', () => {
		function editNote( otherImages: ComposerImageAttachment[] = [] ) {
			let editing = '';
			act( () => {
				setAnnotating( SITE, true );
				if ( otherImages.length ) {
					const other = pickAnnotation( SITE, { selector: 'p' } )!;
					changeAnnotation( SITE, other, { images: otherImages } );
				}
				editing = pickAnnotation( SITE, { selector: 'h1' } )!;
			} );
			return () =>
				getSiteAnnotations( SITE ).notes.find( ( note ) => note.id === editing )?.images ?? [];
		}
		const upload = ( files: File[] ) =>
			fireEvent.change( document.querySelector( 'input[type="file"]' )!, { target: { files } } );

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

	describe( 'send button', () => {
		function addNotes( count: number, staged: boolean ) {
			act( () => {
				setAnnotating( SITE, true );
				for ( let index = 0; index < count; index++ ) {
					const id = pickAnnotation( SITE, { selector: `h${ index }` } )!;
					changeAnnotation( SITE, id, { comment: `Note ${ index }` } );
				}
				if ( staged ) {
					stageAnnotations( SITE );
				}
			} );
		}

		it( 'keeps the labeled floating action and its count', async () => {
			addNotes( 3, true );
			await setup( null );
			expect( screen.getByRole( 'button', { name: 'Send 3 annotations' } ) ).toHaveTextContent(
				'Send3'
			);
		} );

		it( 'shows no count for an unstaged draft', async () => {
			addNotes( 1, false );
			await setup( null );
			expect( screen.getByRole( 'button', { name: 'Send 1 annotation' } ) ).toHaveTextContent(
				/^Send$/
			);
		} );
	} );
} );
