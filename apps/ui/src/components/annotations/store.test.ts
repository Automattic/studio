import { describe, expect, it, vi } from 'vitest';
import {
	changeAnnotation,
	getSiteAnnotations,
	pickAnnotation,
	requestAnnotationSend,
	setAnnotating,
	subscribeAnnotationSend,
} from './store';

describe( 'annotation store', () => {
	it( 'drops a note left empty and numbers the next one after those kept', () => {
		setAnnotating( 'store-site', true );
		const kept = pickAnnotation( 'store-site', { selector: 'h1' } );
		changeAnnotation( 'store-site', kept, { comment: 'Bigger' } );
		pickAnnotation( 'store-site', { selector: 'p' } );
		const last = pickAnnotation( 'store-site', { selector: 'footer' } );

		expect(
			getSiteAnnotations( 'store-site' ).notes.map( ( { selector, number } ) => [
				selector,
				number,
			] )
		).toEqual( [
			[ 'h1', 1 ],
			[ 'footer', 2 ],
		] );
		expect( getSiteAnnotations( 'store-site' ).editingId ).toBe( last );
	} );

	it( 'reopens the note of a design token picked again', () => {
		const id = pickAnnotation( 'design-site', { designKey: 'colors.primary' } );
		changeAnnotation( 'design-site', id, { comment: 'Warmer' } );

		expect( pickAnnotation( 'design-site', { designKey: 'colors.primary' } ) ).toBe( id );
		expect( getSiteAnnotations( 'design-site' ).notes ).toHaveLength( 1 );
	} );

	it( 'holds a send request until a chat for that site takes it', () => {
		const onRequest = vi.fn();
		requestAnnotationSend( { siteId: 'send-site', noteIds: [ 'n1' ] } );
		const unsubscribeOther = subscribeAnnotationSend( 'other-site', onRequest );
		expect( onRequest ).not.toHaveBeenCalled();

		const unsubscribe = subscribeAnnotationSend( 'send-site', onRequest );
		expect( onRequest ).toHaveBeenCalledWith( { siteId: 'send-site', noteIds: [ 'n1' ] } );
		unsubscribe();
		unsubscribeOther();
	} );
} );
