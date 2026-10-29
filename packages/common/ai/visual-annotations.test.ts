import { describe, expect, it } from 'vitest';
import {
	formatVisualAnnotationsPrompt,
	validateStudioVisualAnnotations,
} from './visual-annotations';

describe( 'validateStudioVisualAnnotations', () => {
	it( 'accepts and normalizes annotation summaries', () => {
		expect(
			validateStudioVisualAnnotations( [
				{
					comment: '  Make this larger  ',
					tag: ' h1 ',
					elementLabel: '',
				},
			] )
		).toEqual( [
			{
				comment: 'Make this larger',
				tag: 'h1',
				elementLabel: undefined,
				nearbyText: undefined,
			},
		] );
	} );

	it( 'allows an omitted payload', () => {
		expect( validateStudioVisualAnnotations( undefined ) ).toBeUndefined();
	} );

	it.each( [ [], [ { comment: '' } ], [ { comment: 'Valid', tag: 42 } ], 'invalid' ] )(
		'rejects an invalid payload',
		( value ) => {
			expect( () => validateStudioVisualAnnotations( value ) ).toThrow();
		}
	);

	it( 'rejects unexpected and oversized fields', () => {
		expect( () =>
			validateStudioVisualAnnotations( [ { comment: 'Valid', selector: '#private' } ] )
		).toThrow( 'Invalid visual annotation' );
		expect( () =>
			validateStudioVisualAnnotations( [ { comment: 'x'.repeat( 1_000_001 ) } ] )
		).toThrow( 'too much data' );
	} );

	it( 'accepts image references only to the message’s own images', () => {
		const images = [ { id: 'shot' } ];
		expect(
			validateStudioVisualAnnotations( [ { comment: '', imageIds: [ 'shot' ] } ], images )
		).toEqual( [ expect.objectContaining( { comment: '', imageIds: [ 'shot' ] } ) ] );
		expect( () =>
			validateStudioVisualAnnotations(
				[ { comment: 'See this', imageIds: [ 'missing' ] } ],
				images
			)
		).toThrow( 'Invalid annotation image references' );
	} );
} );

describe( 'formatVisualAnnotationsPrompt', () => {
	it( 'tells the agent which email a note is on and where to change it', () => {
		const prompt = formatVisualAnnotationsPrompt(
			[
				{
					id: 'note-1',
					number: 1,
					comment: 'Use the site accent color',
					images: [],
					tag: 'a',
					selector: 'body > table > tbody > tr > td > a',
					nearbyText: 'View your order',
					email: { id: 'order.eml', subject: 'Your order has been received!', part: 'html' },
					targetKey: 'email:order.eml:html:body > table > tbody > tr > td > a',
				},
				{
					id: 'note-2',
					number: 2,
					comment: 'Say this more kindly',
					images: [],
					nearbyText: 'No further action is needed on your part.',
					email: {
						id: 'update.eml',
						subject: 'Some plugins were updated',
						part: 'text',
						paragraph: 0,
					},
				},
			],
			[]
		);

		expect( prompt ).toContain(
			'Annotations from the Email view are about an email the site sent.'
		);
		expect( prompt ).toContain(
			'### 1. <a> - "View your order"\n- Page: Email "Your order has been received!"'
		);
		expect( prompt ).toContain(
			'### 2. email text paragraph 1 - "No further action is needed on your part."\n- Page: Email "Some plugins were updated"'
		);
		expect( prompt ).not.toContain( 'targetKey' );
	} );
} );
