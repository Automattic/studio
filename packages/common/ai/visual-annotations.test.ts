import { describe, expect, it } from 'vitest';
import { validateStudioVisualAnnotations } from './visual-annotations';

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
} );
