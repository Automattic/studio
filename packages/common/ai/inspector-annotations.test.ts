import { describe, expect, it } from 'vitest';
import { validateStudioInspectorAnnotations } from './inspector-annotations';

describe( 'validateStudioInspectorAnnotations', () => {
	it( 'accepts valid annotations', () => {
		const annotations = [ { id: 'a_1', comment: 'Make this smaller', selector: '#hero' } ];
		expect( validateStudioInspectorAnnotations( annotations ) ).toBe( annotations );
	} );

	it.each( [ [], [ { comment: 'Missing id' } ], [ { id: 'a_1', comment: '' } ], 'invalid' ] )(
		'rejects invalid annotations',
		( value ) => {
			expect( () => validateStudioInspectorAnnotations( value ) ).toThrow();
		}
	);

	it( 'rejects oversized annotation data', () => {
		expect( () =>
			validateStudioInspectorAnnotations( [
				{ id: 'a_1', comment: 'Valid', computedStyles: 'x'.repeat( 1_000_000 ) },
			] )
		).toThrow( 'too much data' );
	} );
} );
