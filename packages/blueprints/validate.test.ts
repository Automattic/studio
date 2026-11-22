import { describe, expect, it } from 'vitest';
import { validateBlueprint } from './validate';

describe( 'validateBlueprint', () => {
	it( 'returns a Blueprint that matches the schema', () => {
		const blueprint = {
			preferredVersions: { php: '8.3', wp: 'latest' },
			steps: [
				{
					step: 'installPlugin',
					pluginData: { resource: 'wordpress.org/plugins', slug: 'akismet' },
				},
			],
		};
		expect( validateBlueprint( blueprint ) ).toBe( blueprint );
	} );

	it( 'names an unknown property and where it is', () => {
		expect( () => validateBlueprint( { name: 'my-package', version: '1.0.0' } ) ).toThrow(
			'"name" is not a valid Blueprint property'
		);
		expect( () => validateBlueprint( { steps: [ { step: 'notAStep' } ] } ) ).toThrow(
			'at /steps/0'
		);
	} );

	it( 'rejects Blueprint v2 and values that are not objects', () => {
		expect( () => validateBlueprint( { version: 2 } ) ).toThrow( 'Blueprint v2 format' );
		expect( () => validateBlueprint( null ) ).toThrow();
		expect( () => validateBlueprint( [] ) ).toThrow();
	} );
} );
