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

	it.each( [
		[ { id: 'a_1', comment: 'Valid', unexpected: true } ],
		[ { id: 'a_1', comment: 'Valid', boundingBox: { width: '10', height: 20 } } ],
		[ { id: 'a_1', comment: 'Valid', computedStyles: { color: 42 } } ],
	] )( 'rejects unrecognized or malformed browser metadata', ( value ) => {
		expect( () => validateStudioInspectorAnnotations( value ) ).toThrow(
			'Invalid inspector annotation'
		);
	} );

	it( 'rejects data that cannot be serialized', () => {
		expect( () =>
			validateStudioInspectorAnnotations( [
				{ id: 'a_1', comment: 'Valid', timestamp: BigInt( 1 ) },
			] )
		).toThrow( 'Invalid inspector annotations' );
	} );
} );
