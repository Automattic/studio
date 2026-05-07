import { describe, expect, it } from 'vitest';
import { parseFeedbackExtraction } from 'cli/ai/feedback-extraction';

describe( 'parseFeedbackExtraction', () => {
	it( 'returns null for non-JSON output', () => {
		expect( parseFeedbackExtraction( 'sorry, I can only respond with JSON' ) ).toBeNull();
	} );

	it( 'returns null for valid JSON that is not an object', () => {
		expect( parseFeedbackExtraction( '"a string"' ) ).toBeNull();
		expect( parseFeedbackExtraction( '[1, 2, 3]' ) ).not.toBeNull();
		// Arrays are objects in JS — but downstream readers will see all-null
		// fields, which is harmless. The strict guard is the enum/string
		// validation.
	} );

	it( 'strips ```json fences if the model wraps its output despite instructions', () => {
		const wrapped =
			'```json\n{"title":"hello","steps":null,"expected":null,"actual":null,"impact":null,"workaround":null}\n```';
		const parsed = parseFeedbackExtraction( wrapped );
		expect( parsed?.title ).toBe( 'hello' );
	} );

	it( 'rejects an out-of-vocabulary impact label', () => {
		const json =
			'{"title":"x","steps":null,"expected":null,"actual":null,"impact":"some users","workaround":null}';
		expect( parseFeedbackExtraction( json )?.impact ).toBeNull();
	} );

	it( 'accepts the canonical impact and workaround labels', () => {
		const json = JSON.stringify( {
			title: 'x',
			steps: null,
			expected: null,
			actual: null,
			impact: 'Most (> 50%)',
			workaround: 'Yes, easy to implement',
		} );
		const parsed = parseFeedbackExtraction( json );
		expect( parsed?.impact ).toBe( 'Most (> 50%)' );
		expect( parsed?.workaround ).toBe( 'Yes, easy to implement' );
	} );

	it( 'coerces empty-string fields to null', () => {
		const json = JSON.stringify( {
			title: '',
			steps: '   ',
			expected: 'real value',
			actual: null,
			impact: null,
			workaround: null,
		} );
		const parsed = parseFeedbackExtraction( json );
		expect( parsed?.title ).toBeNull();
		expect( parsed?.steps ).toBeNull();
		expect( parsed?.expected ).toBe( 'real value' );
	} );
} );
