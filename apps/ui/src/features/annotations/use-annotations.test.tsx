import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

async function setup( onSend: ( noteIds?: string[] ) => void = vi.fn() ) {
	act( () => setAnnotating( SITE, true ) );
	renderWithProviders(
		<AnnotationOverlay siteId={ SITE } anchor={ { left: 10, top: 20 } } onSend={ onSend } />
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

	it( 'sends the open note with Enter and keeps annotation mode active', async () => {
		const { onSend } = await setup();
		const id = add( 'Make the heading smaller' );
		save();
		expect( onSend ).toHaveBeenCalledExactlyOnceWith( [ id ] );
		expect( session().editingId ).toBeNull();
		expect( session().active ).toBe( true );
		expect( stagedCount() ).toBe( 0 );
	} );

	it( 'sends only the current note without including another draft', async () => {
		const { onSend } = await setup();
		add( 'Another draft' );
		const id = add( 'Send this one' );
		save();
		expect( onSend ).toHaveBeenCalledExactlyOnceWith( [ id ] );
		expect( session().notes ).toHaveLength( 2 );
	} );

	it( 'batches only when enabled and returns to immediate sends without clearing the batch', async () => {
		const { onSend } = await setup();
		const first = add( 'Save this for later' );
		const toggle = screen.getByRole( 'checkbox', { name: 'Batch notes' } );
		expect( toggle ).not.toBeChecked();
		fireEvent.click( toggle );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Add annotation to batch' } ) );
		expect( onSend ).not.toHaveBeenCalled();
		expect( session().notes.find( ( note ) => note.id === first )?.staged ).toBe( true );
		act( () => setAnnotating( SITE, false ) );
		act( () => setAnnotating( SITE, true ) );
		const second = add( 'Send this now' );
		expect( screen.getByRole( 'checkbox', { name: 'Batch notes' } ) ).toBeChecked();
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Batch notes' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Send annotation' } ) );
		expect( onSend ).toHaveBeenCalledExactlyOnceWith( [ second ] );
		expect( stagedCount() ).toBe( 1 );
	} );

	it( 'shares the persisted batching checkbox across sites', async () => {
		const other = 'global-batch-other';
		act( () => {
			setAnnotating( SITE, true );
			setAnnotating( other, true );
		} );
		add( 'First site', SITE );
		add( 'Second site', other );
		const { connector } = renderWithProviders(
			<>
				<AnnotationOverlay siteId={ SITE } anchor={ { left: 10, top: 10 } } onSend={ vi.fn() } />
				<AnnotationOverlay siteId={ other } anchor={ { left: 10, top: 100 } } onSend={ vi.fn() } />
			</>
		);
		try {
			const checkboxes = await screen.findAllByRole( 'checkbox', { name: 'Batch notes' } );
			fireEvent.click( checkboxes[ 0 ] );
			await waitFor( () => checkboxes.forEach( ( control ) => expect( control ).toBeChecked() ) );
			expect( connector.setUserPreferences ).toHaveBeenCalledWith(
				{ batchAnnotations: true },
				undefined
			);
			fireEvent.click( checkboxes[ 1 ] );
			await waitFor( () =>
				checkboxes.forEach( ( control ) => expect( control ).not.toBeChecked() )
			);
		} finally {
			act( () => {
				removeAnnotations(
					other,
					getSiteAnnotations( other ).notes.map( ( note ) => note.id )
				);
				setAnnotating( other, false );
			} );
		}
	} );

	it( 'removes a saved attachment after its note is emptied and dismissed', async () => {
		await setup();
		const id = add( 'Saved note' );
		save();
		act( () => editAnnotation( SITE, id ) );
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
		add( '' );
		act( () => editAnnotation( SITE, first ) );
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
		act( () => removeAnnotations( SITE, [ first ] ) );
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
		const { onSend } = await setup();
		const id = add( 'Make this heading larger' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send annotation' } ) );
		expect( onSend ).toHaveBeenCalledExactlyOnceWith( [ id ] );
		expect( stagedCount() ).toBe( 0 );
		expect( session().notes[ 0 ].id ).toBe( id );
		expect( session().active ).toBe( true );
		expect( session().editingId ).toBeNull();
		expect( screen.queryByRole( 'button', { name: 'Send 1 annotation' } ) ).not.toBeInTheDocument();
	} );

	it.each( [ 'metaKey', 'ctrlKey' ] )(
		'sends only the open note directly with %s and keeps annotating',
		async ( modifier ) => {
			const { onSend } = await setup();
			add( 'First' );
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
		expect( screen.getByRole( 'button', { name: 'Send annotation' } ) ).toBeDisabled();
		add( 'Image coming' );
		expect( screen.getByRole( 'button', { name: 'Send annotation' } ) ).toBeEnabled();
		act( () => setAnnotationsPreparing( SITE, true ) );
		expect( screen.getByRole( 'button', { name: 'Send annotation' } ) ).toBeDisabled();
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
			act( () => editAnnotation( SITE, id ) );
			expect( screen.getByRole( 'button', { name: 'Send annotation' } ) ).toBeDisabled();
			fireEvent.keyDown( note(), { key: 'Enter', ctrlKey: true } );
			expect( accept ).toHaveBeenCalledTimes( 1 );
			await act( async () => resolve() );
			await waitFor( () => expect( session().sending ).toBe( false ) );
		} finally {
			unsubscribe();
		}
	} );
} );
