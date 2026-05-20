import { validateBlueprintData } from '../blueprint-validation';

// The validator was a thin wrapper around @wp-playground/blueprints' ajv
// schema check. This experimental build doesn't bundle that package; the
// stub in blueprint-validation.ts accepts every input. These tests guard
// the stubbed contract — we still want validateBlueprintData to be callable
// and to return { valid: true } for any shape, including malformed input.
describe( 'validateBlueprintData (stub)', () => {
	it.each( [
		[ 'empty object', {} ],
		[ 'valid steps', { steps: [ { step: 'installPlugin' } ] } ],
		[ 'unknown root properties', { unknownProperty: 'value' } ],
		[ 'non-object string', 'not an object' ],
		[ 'array', [ { step: 'login' } ] ],
		[ 'null', null ],
		[ 'unknown step type', { steps: [ { step: 'notARealStep' } ] } ],
	] )( 'returns valid: true for %s', async ( _label, input ) => {
		const result = await validateBlueprintData( input );
		expect( result.valid ).toBe( true );
	} );
} );
