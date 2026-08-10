import { describe, expect, it } from 'vitest';
import { normalizeBlueprintForRunner } from 'cli/lib/native-php/blueprints';

describe( 'normalizeBlueprintForRunner', () => {
	it( 'drops preferredVersions', () => {
		const contents = { preferredVersions: { php: '8.3', wp: 'latest' }, steps: [] };

		normalizeBlueprintForRunner( contents );

		expect( contents ).not.toHaveProperty( 'preferredVersions' );
	} );

	// `intl` is the one gallery Blueprints such as Stylish Press set.
	it( 'drops features the runner does not know', () => {
		const contents = { features: { intl: true, networking: true }, steps: [] };

		normalizeBlueprintForRunner( contents );

		expect( contents.features ).toEqual( { networking: true } );
	} );

	it( 'removes features entirely when nothing supported is left', () => {
		const contents: Record< string, unknown > = { features: { intl: true }, steps: [] };

		normalizeBlueprintForRunner( contents );

		expect( contents ).not.toHaveProperty( 'features' );
	} );

	it( 'leaves a Blueprint without features or preferredVersions untouched', () => {
		const contents = { steps: [ { step: 'installPlugin' } ] };

		normalizeBlueprintForRunner( contents );

		expect( contents ).toEqual( { steps: [ { step: 'installPlugin' } ] } );
	} );

	it( 'tolerates a features value that is not an object', () => {
		const contents: Record< string, unknown > = { features: null, steps: [] };

		expect( () => normalizeBlueprintForRunner( contents ) ).not.toThrow();
	} );
} );
