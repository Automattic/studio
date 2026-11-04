import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AnnotationOverlay } from './overlay';
import {
	changeAnnotation,
	editAnnotation,
	escapeAnnotations,
	getSiteAnnotations,
	hasAnnotationContent,
	isStagedAnnotation,
	pickAnnotation,
	removeAnnotations,
	requestAnnotationSend,
	setAnnotating,
	setAnnotationsPreparing,
	subscribeAnnotationSend,
	stageAnnotations,
} from './store';

const SITE = 'site-1';
const target = { selector: 'h1', tag: 'h1', path: '/' };

afterEach( () => {
	removeAnnotations(
		SITE,
		getSiteAnnotations( SITE ).notes.map( ( note ) => note.id )
	);
	setAnnotating( SITE, false );
	setAnnotationsPreparing( SITE, false );
} );

const session = ( site = SITE ) => getSiteAnnotations( site );
const count = ( site = SITE ) => session( site ).notes.filter( hasAnnotationContent ).length;
const stagedCount = ( site = SITE ) => session( site ).notes.filter( isStagedAnnotation ).length;

function add( comment: string, site = SITE ) {
	let id = '';
	act( () => {
		id = pickAnnotation( site, target )!;
		changeAnnotation( site, id, { comment } );
	} );
	return id;
}

async function setup( onSend: ( noteIds?: string[] ) => void = vi.fn(), batchAnnotations = true ) {
	act( () => setAnnotating( SITE, true ) );
	renderWithProviders(
		<AnnotationOverlay siteId={ SITE } anchor={ { left: 10, top: 20 } } onSend={ onSend } />,
		{ connector: createFakeConnector( { preferences: { batchAnnotations } } ) }
	);
	await waitFor( () =>
		expect( document.querySelector( '[data-annotation-overlay]' ) ).not.toBeNull()
	);
	return { onSend };
}

const note = () => screen.getByRole( 'textbox', { name: 'Describe the change' } );
const save = () => fireEvent.keyDown( note(), { key: 'Enter' } );

describe( 'preview annotation sessions', () => {
	it( 'deletes only the edited note and keeps annotation mode and other notes', async () => {
		const { onSend } = await setup();
		const kept = add( 'Keep this note' );
		save();
		const deleted = add( 'Delete this note' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Delete annotation' } ) );
		expect( session().notes.map( ( note ) => note.id ) ).toEqual( [ kept ] );
		expect( session().notes.some( ( note ) => note.id === deleted ) ).toBe( false );
		expect( session().editingId ).toBeNull();
		expect( session().active ).toBe( true );
		expect(
			screen.queryByRole( 'textbox', { name: 'Describe the change' } )
		).not.toBeInTheDocument();
		expect( onSend ).not.toHaveBeenCalled();
	} );

	it( 'sends with Enter when batching is explicitly disabled in Settings', async () => {
		const { onSend } = await setup( vi.fn(), false );
		const id = add( 'Make the heading smaller' );
		save();
		expect( onSend ).toHaveBeenCalledExactlyOnceWith( [ id ] );
		expect( session().editingId ).toBeNull();
		expect( session().active ).toBe( true );
		expect( stagedCount() ).toBe( 0 );
	} );

	it( 'adds notes to the batch by default without an inline setting', async () => {
		const { onSend } = await setup();
		const id = add( 'Save this for later' );
		expect( screen.queryByRole( 'checkbox', { name: 'Batch notes' } ) ).not.toBeInTheDocument();
		save();
		expect( onSend ).not.toHaveBeenCalled();
		expect( session().notes.find( ( note ) => note.id === id ) ).toMatchObject( {
			staged: true,
			batched: true,
		} );
		expect( session().editingId ).toBeNull();
	} );

	it( 'keeps a started draft open and gives feedback before picking or editing another note', async () => {
		await setup();
		const saved = add( 'Saved note' );
		save();
		const draft = add( 'Unfinished note' );
		let picked: string | null = null;
		act( () => {
			picked = pickAnnotation( SITE, { selector: 'p' } );
		} );
		expect( picked ).toBeNull();
		expect( session().notes ).toHaveLength( 2 );
		expect( session().editingId ).toBe( draft );
		expect( screen.getByRole( 'group', { name: 'Annotation' } ) ).toHaveAttribute(
			'data-feedback',
			'shake'
		);
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'Add or delete this annotation' );
		act( () => {
			editAnnotation( SITE, saved );
		} );
		expect( session().editingId ).toBe( draft );
		act( () => escapeAnnotations( SITE ) );
		expect( session().active ).toBe( true );
		save();
		act( () => {
			editAnnotation( SITE, saved );
		} );
		expect( session().editingId ).toBe( saved );
		fireEvent.change( note(), { target: { value: 'Revised note' } } );
		act( () => {
			picked = pickAnnotation( SITE, { selector: 'footer' } );
		} );
		expect( picked ).toBeNull();
		expect( session().editingId ).toBe( saved );
		fireEvent.click( screen.getByRole( 'button', { name: 'Delete annotation' } ) );
		act( () => {
			picked = pickAnnotation( SITE, { selector: 'footer' } );
		} );
		expect( picked ).not.toBeNull();
	} );

	it( 'removes a saved attachment after its note is emptied and dismissed', async () => {
		await setup();
		const id = add( 'Saved note' );
		save();
		act( () => {
			editAnnotation( SITE, id );
		} );
		act( () => changeAnnotation( SITE, id, { comment: '' } ) );
		act( () => escapeAnnotations( SITE ) );
		expect( session().notes.map( ( item ) => item.id ) ).not.toContain( id );
		expect( count() ).toBe( 0 );
	} );

	it( 'reuses the number while replacing empty or whitespace-only selections', () => {
		act( () => setAnnotating( SITE, true ) );
		for ( const comment of [ '', '   ', '', '\n' ] ) {
			add( comment );
			expect( session().notes ).toEqual( [ expect.objectContaining( { number: 1, comment } ) ] );
			expect( count() ).toBe( 0 );
		}
	} );

	it( 'discards an empty selection when closing or opening an existing note', () => {
		act( () => setAnnotating( SITE, true ) );
		const first = add( 'Keep this note' );
		act( () => stageAnnotations( SITE ) );
		add( '' );
		act( () => {
			editAnnotation( SITE, first );
		} );
		expect( session().notes ).toHaveLength( 1 );
		const empty = add( 'Temporary text' );
		act( () => changeAnnotation( SITE, empty, { comment: '' } ) );
		act( () => escapeAnnotations( SITE ) );
		expect( session().notes ).toEqual( [ expect.objectContaining( { id: first, number: 1 } ) ] );
		expect( session().editingId ).toBeNull();
		expect( session().active ).toBe( false );
		act( () => setAnnotating( SITE, true ) );
		add( '' );
		expect( session().notes.at( -1 )?.number ).toBe( 2 );
	} );

	it( 'preserves image-only notes and existing numbers when selecting another element', () => {
		act( () => setAnnotating( SITE, true ) );
		const first = add( 'First' );
		act( () => stageAnnotations( SITE ) );
		const imageNote = add( '' );
		act( () =>
			changeAnnotation( SITE, imageNote, {
				images: [
					{
						id: 'image',
						kind: 'image',
						name: 'reference.png',
						mimeType: 'image/png',
						size: 1,
						dataBase64: 'YQ==',
					},
				],
			} )
		);
		act( () => {
			stageAnnotations( SITE );
			removeAnnotations( SITE, [ first ] );
		} );
		add( '' );
		add( '' );
		expect( session().notes ).toEqual( [
			expect.objectContaining( { id: imageNote, number: 2, images: [ expect.anything() ] } ),
			expect.objectContaining( { number: 3, comment: '' } ),
		] );
		expect( count() ).toBe( 1 );
	} );

	it( 'preserves drafts when annotating stops', () => {
		act( () => setAnnotating( SITE, true ) );
		const id = add( 'Make it shorter' );
		act( () => setAnnotating( SITE, false ) );
		expect( session().active ).toBe( false );
		expect( session().notes[ 0 ].id ).toBe( id );
	} );

	it( 'sends the open note from its button without rendering a batch send action', async () => {
		const { onSend } = await setup( vi.fn(), false );
		const id = add( 'Make this heading larger' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send annotation' } ) );
		expect( onSend ).toHaveBeenCalledExactlyOnceWith( [ id ] );
		expect( stagedCount() ).toBe( 0 );
		expect( session().notes[ 0 ].id ).toBe( id );
		expect( session().active ).toBe( true );
		expect( session().editingId ).toBeNull();
		expect( screen.queryByRole( 'button', { name: 'Send 1 annotation' } ) ).not.toBeInTheDocument();
	} );

	it.each( [ 'ctrlKey' ] )(
		'sends only the open note directly with %s and keeps annotating',
		async ( modifier ) => {
			const { onSend } = await setup();
			add( 'First' );
			save();
			const second = add( 'Second' );
			fireEvent.keyDown( note(), { key: 'Enter', [ modifier ]: true } );
			expect( onSend ).toHaveBeenCalledWith( [ second ] );
			expect( session().active ).toBe( true );
			expect( session().editingId ).toBeNull();
		}
	);

	it( 'ignores empty notes and blocks sends during attachment preparation', async () => {
		const { onSend } = await setup();
		add( '   ' );
		expect( screen.getByRole( 'button', { name: 'Add annotation to batch' } ) ).toBeDisabled();
		add( 'Image coming' );
		expect( screen.getByRole( 'button', { name: 'Add annotation to batch' } ) ).toBeEnabled();
		act( () => setAnnotationsPreparing( SITE, true ) );
		expect( screen.getByRole( 'button', { name: 'Add annotation to batch' } ) ).toBeDisabled();
		fireEvent.keyDown( note(), { key: 'Enter', ctrlKey: true } );
		expect( onSend ).not.toHaveBeenCalled();
		expect( session().editingId ).not.toBeNull();
	} );

	it( 'prevents duplicate submissions while acceptance is pending', async () => {
		let resolve!: () => void;
		const accept = vi.fn(
			() =>
				new Promise< void >( ( accepted ) => {
					resolve = accepted;
				} )
		);
		const unsubscribe = subscribeAnnotationSend( SITE, accept );
		try {
			await setup( ( noteIds?: string[] ) => requestAnnotationSend( { siteId: SITE, noteIds } ) );
			const id = add( 'Once' );
			fireEvent.keyDown( note(), { key: 'Enter', ctrlKey: true } );
			expect( session().sending ).toBe( true );
			act( () => {
				editAnnotation( SITE, id );
			} );
			expect( screen.getByRole( 'button', { name: 'Add annotation to batch' } ) ).toBeDisabled();
			fireEvent.keyDown( note(), { key: 'Enter', ctrlKey: true } );
			expect( accept ).toHaveBeenCalledTimes( 1 );
			await act( async () => resolve() );
			await waitFor( () => expect( session().sending ).toBe( false ) );
		} finally {
			unsubscribe();
		}
	} );
} );
