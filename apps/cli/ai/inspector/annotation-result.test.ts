import { describe, expect, it } from 'vitest';
import { validateAnnotationDoneResult } from './annotation-result';

describe( 'validateAnnotationDoneResult', () => {
	it( 'accepts a valid browser result', () => {
		const result = {
			capturedAt: Date.now(),
			url: 'http://example.test/',
			annotations: [ { id: 'a_1', comment: 'Make this smaller', selector: '#hero' } ],
		};

		expect( validateAnnotationDoneResult( result ) ).toBe( result );
	} );

	it.each( [
		null,
		{},
		{ capturedAt: Date.now(), url: 'http://example.test/', annotations: [] },
		{
			capturedAt: Date.now(),
			url: 'http://example.test/',
			annotations: [ { id: 'a_1', comment: '' } ],
		},
	] )( 'rejects an invalid browser result', ( value ) => {
		expect( () => validateAnnotationDoneResult( value ) ).toThrow();
	} );

	it( 'rejects an oversized browser result', () => {
		expect( () =>
			validateAnnotationDoneResult( {
				capturedAt: Date.now(),
				url: 'http://example.test/',
				annotations: [ { id: 'a_1', comment: 'Valid', extra: 'x'.repeat( 1_000_000 ) } ],
			} )
		).toThrow( 'too much data' );
	} );
} );
