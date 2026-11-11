import { describe, expect, it } from 'vitest';
import { getBlueprintUseCases } from '../blueprint-catalog';

function withCategories( categories: unknown ) {
	return { blueprint: { meta: { categories } } };
}

describe( 'getBlueprintUseCases', () => {
	it( 'derives use cases from the Blueprint categories', () => {
		expect(
			getBlueprintUseCases( withCategories( [ 'Store', 'Studio', 'WooCommerce' ] ) )
		).toEqual( [ 'store' ] );
		expect( getBlueprintUseCases( withCategories( [ 'Blog', 'Portfolio' ] ) ) ).toEqual( [
			'blog',
			'portfolio',
		] );
	} );

	it( 'ignores case and accepts singular category names', () => {
		expect( getBlueprintUseCases( withCategories( [ 'Event', ' development ' ] ) ) ).toEqual( [
			'events',
			'development',
		] );
		expect( getBlueprintUseCases( withCategories( [ 'BUSINESS', 'Events' ] ) ) ).toEqual( [
			'business',
			'events',
		] );
	} );

	it( 'returns no use cases when categories are missing or malformed', () => {
		expect( getBlueprintUseCases( { blueprint: {} } ) ).toEqual( [] );
		expect( getBlueprintUseCases( { blueprint: { meta: null } } ) ).toEqual( [] );
		expect( getBlueprintUseCases( withCategories( 'Store' ) ) ).toEqual( [] );
		expect( getBlueprintUseCases( withCategories( [ 42, null, 'Gallery' ] ) ) ).toEqual( [] );
	} );
} );
