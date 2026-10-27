import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { AnnotationOverlay } from './overlay';
import {
	changeAnnotation,
	clearAnnotations,
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
	clearAnnotations( SITE );
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

const note = () => screen.getByRole( 'textbox', { name: 'Leave a note' } );
const save = () => fireEvent.keyDown( note(), { key: 'Enter' } );

describe( 'preview annotation sessions', () => {
	it( 'stages the saved note without sending or leaving annotation mode', async () => {
		const { onSend } = await setup();
		const id = add( 'Ready for the composer' );
		expect( stagedCount() ).toBe( 0 );
		save();
		expect( onSend ).not.toHaveBeenCalled();
		expect( session().editingId ).toBeNull();
		expect( session().active ).toBe( true );
		expect( count() ).toBe( 1 );
		expect( stagedCount() ).toBe( 1 );
		act( () => removeAnnotations( SITE, [ id ] ) );
		expect( count() ).toBe( 0 );
		expect( stagedCount() ).toBe( 0 );
	} );

	it( 'counts a staged note once while preserving the count through editing', async () => {
		await setup();
		const id = add( 'Staged note' );
		save();
		add( 'Unstaged draft' );
		expect( stagedCount() ).toBe( 1 );
		act( () => editAnnotation( SITE, id ) );
		act( () => changeAnnotation( SITE, id, { comment: 'Updated note' } ) );
		save();
		expect( stagedCount() ).toBe( 1 );
		act( () => removeAnnotations( SITE, [ id ] ) );
		expect( stagedCount() ).toBe( 0 );
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
		expect( session().active ).toBe( true );
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

	it( 'sends the open note directly when clicking Send', async () => {
		const { onSend } = await setup();
		const id = add( 'Make this heading larger' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send annotation' } ) );
		expect( onSend ).toHaveBeenCalledWith( [ id ] );
		expect( stagedCount() ).toBe( 0 );
		expect( session().editingId ).toBeNull();
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
		await setup();
		add( '   ' );
		expect( screen.getByRole( 'button', { name: /^Send \d+ annotation/ } ) ).toBeDisabled();
		add( 'Image coming' );
		expect( screen.getByRole( 'button', { name: 'Send 1 annotation' } ) ).toBeEnabled();
		act( () => setAnnotationsPreparing( SITE, true ) );
		expect( screen.getByRole( 'button', { name: 'Send 1 annotation' } ) ).toBeDisabled();
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
			add( 'Once' );
			const send = screen.getByRole( 'button', { name: 'Send 1 annotation' } );
			fireEvent.click( send );
			expect( send ).toBeDisabled();
			fireEvent.click( send );
			expect( accept ).toHaveBeenCalledTimes( 1 );
			await act( async () => resolve() );
			await waitFor( () => expect( session().sending ).toBe( false ) );
		} finally {
			unsubscribe();
		}
	} );
} );
