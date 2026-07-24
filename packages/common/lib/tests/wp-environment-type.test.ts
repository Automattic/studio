import { getWpEnvironmentType, wpEnvironmentTypeSchema } from '../wp-environment-type';

describe( 'getWpEnvironmentType', () => {
	it( 'falls back to "local" when the site has no stored value', () => {
		expect( getWpEnvironmentType( {} ) ).toBe( 'local' );
	} );

	it( 'returns the stored value when set', () => {
		expect( getWpEnvironmentType( { environmentType: 'production' } ) ).toBe( 'production' );
	} );
} );

describe( 'wpEnvironmentTypeSchema', () => {
	it( 'accepts the four values WordPress recognizes', () => {
		for ( const value of [ 'local', 'development', 'staging', 'production' ] ) {
			expect( wpEnvironmentTypeSchema.parse( value ) ).toBe( value );
		}
	} );

	it( 'rejects anything else', () => {
		expect( () => wpEnvironmentTypeSchema.parse( 'prod' ) ).toThrow();
	} );
} );
