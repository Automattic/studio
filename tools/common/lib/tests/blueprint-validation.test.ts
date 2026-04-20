import { validateBlueprintData } from '../blueprint-validation';

describe( 'validateBlueprintData', () => {
	describe( 'valid blueprints', () => {
		it( 'should accept an empty blueprint object', async () => {
			const result = await validateBlueprintData( {} );

			expect( result.valid ).toBe( true );
		} );

		it( 'should accept a blueprint with valid steps', async () => {
			const blueprint = {
				steps: [
					{
						step: 'installPlugin',
						pluginData: {
							resource: 'wordpress.org/plugins',
							slug: 'akismet',
						},
					},
					{
						step: 'installTheme',
						themeData: {
							resource: 'wordpress.org/themes',
							slug: 'twentytwentyfive',
						},
					},
				],
			};

			const result = await validateBlueprintData( blueprint );

			expect( result.valid ).toBe( true );
		} );

		it( 'should accept a blueprint with meta information', async () => {
			const blueprint = {
				meta: {
					title: 'Test Blueprint',
					author: 'testuser',
				},
			};

			const result = await validateBlueprintData( blueprint );

			expect( result.valid ).toBe( true );
		} );

		it( 'should accept a blueprint with preferredVersions', async () => {
			const blueprint = {
				preferredVersions: {
					php: '8.2',
					wp: '6.5',
				},
			};

			const result = await validateBlueprintData( blueprint );

			expect( result.valid ).toBe( true );
		} );

		it( 'should accept a blueprint with landingPage', async () => {
			const blueprint = {
				landingPage: '/wp-admin/',
			};

			const result = await validateBlueprintData( blueprint );

			expect( result.valid ).toBe( true );
		} );
	} );

	describe( 'invalid blueprints', () => {
		it( 'should reject a package.json-like object', async () => {
			const packageJson = {
				name: 'my-package',
				version: '1.0.0',
				dependencies: {
					lodash: '^4.17.21',
				},
			};

			const result = await validateBlueprintData( packageJson );

			expect( result.valid ).toBe( false );
			if ( ! result.valid ) {
				expect( result.error ).toContain( 'name' );
				expect( result.error ).toContain( 'not a valid Blueprint property' );
			}
		} );

		it( 'should reject objects with unknown root properties', async () => {
			const invalidBlueprint = {
				unknownProperty: 'some value',
				anotherUnknown: true,
			};

			const result = await validateBlueprintData( invalidBlueprint );

			expect( result.valid ).toBe( false );
			if ( ! result.valid ) {
				expect( result.error ).toContain( 'unknownProperty' );
				expect( result.error ).toContain( 'not a valid Blueprint property' );
			}
		} );

		it( 'should reject non-object values', async () => {
			const result = await validateBlueprintData( 'not an object' );

			expect( result.valid ).toBe( false );
		} );

		it( 'should reject arrays', async () => {
			const result = await validateBlueprintData( [ { step: 'login' } ] );

			expect( result.valid ).toBe( false );
		} );

		it( 'should reject null', async () => {
			const result = await validateBlueprintData( null );

			expect( result.valid ).toBe( false );
		} );

		it( 'should reject blueprint with invalid step types', async () => {
			const blueprintWithUnknownStep = {
				steps: [
					{
						step: 'notARealStep',
					},
				],
			};

			const result = await validateBlueprintData( blueprintWithUnknownStep );
			expect( result.valid ).toBe( false );
		} );
	} );
} );
