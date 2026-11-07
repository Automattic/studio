import { MAX_VISUAL_ANNOTATIONS } from '@studio/agent/protocol/visual-annotations';
import { describe, expect, it, vi } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import {
	changeAnnotation,
	escapeAnnotations,
	getSiteAnnotations,
	isBatchedAnnotation,
	stageAnnotations,
	pickAnnotation,
	requestAnnotationSend,
	setAnnotating,
	subscribeAnnotationSend,
} from './store';

describe( 'annotation store', () => {
	it( 'drops a note left empty and numbers the next one after those kept', () => {
		setAnnotating( 'store-site', true );
		const kept = pickAnnotation( 'store-site', { selector: 'h1' } )!;
		changeAnnotation( 'store-site', kept, { comment: 'Bigger' } );
		stageAnnotations( 'store-site' );
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
		const id = pickAnnotation( 'design-site', { targetKey: 'var:preset|color|primary' } )!;
		changeAnnotation( 'design-site', id, { comment: 'Warmer' } );

		expect( pickAnnotation( 'design-site', { targetKey: 'var:preset|color|primary' } ) ).toBe( id );
		expect( getSiteAnnotations( 'design-site' ).notes ).toHaveLength( 1 );
	} );

	it( 'keeps batched notes distinct from immediate submissions when annotation mode changes', () => {
		const siteId = 'batch-store-site';
		setAnnotating( siteId, true );
		const direct = pickAnnotation( siteId, { selector: 'h1' } )!;
		changeAnnotation( siteId, direct, { comment: 'Immediate' } );
		stageAnnotations( siteId, [ direct ] );
		expect( getSiteAnnotations( siteId ).notes.filter( isBatchedAnnotation ) ).toHaveLength( 0 );
		const batched = pickAnnotation( siteId, { selector: 'p' } )!;
		changeAnnotation( siteId, batched, { comment: 'Batch this' } );
		stageAnnotations( siteId, [ batched ], true );
		setAnnotating( siteId, false );
		setAnnotating( siteId, true );
		expect(
			getSiteAnnotations( siteId )
				.notes.filter( isBatchedAnnotation )
				.map( ( note ) => note.id )
		).toEqual( [ batched ] );
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

	it( 'refuses a note past the limit', () => {
		for ( let index = 0; index < MAX_VISUAL_ANNOTATIONS; index++ ) {
			changeAnnotation( 'full-site', pickAnnotation( 'full-site', { selector: `#n${ index }` } )!, {
				comment: 'Note',
			} );
			stageAnnotations( 'full-site' );
		}

		expect( pickAnnotation( 'full-site', { selector: 'footer' } ) ).toBeNull();
		expect( getSiteAnnotations( 'full-site' ).notes ).toHaveLength( MAX_VISUAL_ANNOTATIONS );
		expect( getVisibleToasts().map( ( toast ) => toast.title ) ).toContain(
			'Send or delete some annotations before adding more'
		);
	} );

	it( 'holds picks and Escape while a send is in flight', async () => {
		let finishSend = () => {};
		setAnnotating( 'busy-site', true );
		const unsubscribe = subscribeAnnotationSend(
			'busy-site',
			() => new Promise< void >( ( resolve ) => ( finishSend = resolve ) )
		);
		requestAnnotationSend( { siteId: 'busy-site' } );

		expect( getSiteAnnotations( 'busy-site' ).sending ).toBe( true );
		expect( pickAnnotation( 'busy-site', { selector: 'h1' } ) ).toBeNull();
		escapeAnnotations( 'busy-site' );
		expect( getSiteAnnotations( 'busy-site' ).active ).toBe( true );

		finishSend();
		await vi.waitFor( () => expect( getSiteAnnotations( 'busy-site' ).sending ).toBe( false ) );
		expect( pickAnnotation( 'busy-site', { selector: 'h1' } ) ).not.toBeNull();
		unsubscribe();
	} );
} );
