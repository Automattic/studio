import { describe, expect, it } from 'vitest';
import { validateComposerFocusSearch } from './focus-composer-search';

describe( 'validateComposerFocusSearch', () => {
	it( 'preserves explicit focus requests', () => {
		expect( validateComposerFocusSearch( { focusComposer: true } ) ).toEqual( {
			focusComposer: true,
		} );
		expect( validateComposerFocusSearch( { focusComposer: 'true' } ) ).toEqual( {
			focusComposer: true,
		} );
	} );

	it( 'omits invalid or absent focus requests', () => {
		expect( validateComposerFocusSearch( {} ) ).toEqual( {} );
		expect( validateComposerFocusSearch( { focusComposer: false } ) ).toEqual( {} );
		expect( validateComposerFocusSearch( { focusComposer: 'false' } ) ).toEqual( {} );
	} );
} );
