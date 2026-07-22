import { describe, expect, it, vi } from 'vitest';
import { getBlueprintDisplayDetails, prepareBlueprint } from '../blueprint-selection';

describe( 'prepareBlueprint', () => {
	it( 'uses Blueprint metadata', async () => {
		const validate = vi.fn().mockResolvedValue( { valid: true } );
		const blueprint = {
			meta: { title: 'Portfolio', description: 'A portfolio site', author: 'Studio' },
		};

		await expect(
			prepareBlueprint( blueprint, { fallbackTitle: 'portfolio', validate } )
		).resolves.toEqual( {
			valid: true,
			blueprint,
			title: 'Portfolio',
			excerpt: 'A portfolio site',
		} );
		expect( validate ).toHaveBeenCalledWith( blueprint );
	} );

	it( 'uses the supplied title when Blueprint metadata has no title', () => {
		expect( getBlueprintDisplayDetails( {}, 'portfolio' ) ).toEqual( {
			title: 'portfolio',
			excerpt: '',
		} );
	} );

	it( 'rejects Blueprint v2 before schema validation', async () => {
		const validate = vi.fn();

		await expect(
			prepareBlueprint( { version: 2 }, { fallbackTitle: 'portfolio', validate } )
		).resolves.toEqual( {
			valid: false,
			error: 'Blueprint v2 format is not supported yet. Please use Blueprint v1 format.',
		} );
		expect( validate ).not.toHaveBeenCalled();
	} );

	it( 'returns schema-validation errors', async () => {
		const validate = vi.fn().mockResolvedValue( { valid: false, error: 'Invalid Blueprint' } );

		await expect(
			prepareBlueprint( null, { fallbackTitle: 'portfolio', validate } )
		).resolves.toEqual( { valid: false, error: 'Invalid Blueprint' } );
	} );
} );
