import { describe, expect, it } from 'vitest';
import { buildSiteCreateArgs } from './create';

// Reads a flag's value out of the built argv (the token right after `--<name>`).
function argValue( args: string[], flag: string ): string | undefined {
	const index = args.indexOf( flag );
	return index === -1 ? undefined : args[ index + 1 ];
}

describe( 'buildSiteCreateArgs', () => {
	it( 'appends --flow-type when a flowType is provided', () => {
		const { args } = buildSiteCreateArgs( { path: '/tmp/site', flowType: 'import' } );

		expect( argValue( args, '--flow-type' ) ).toBe( 'import' );
	} );

	it( 'omits --flow-type when no flowType is provided', () => {
		const { args } = buildSiteCreateArgs( { path: '/tmp/site' } );

		expect( args ).not.toContain( '--flow-type' );
	} );

	it( 'passes the frontend choice for a headless site', () => {
		const { args } = buildSiteCreateArgs( {
			path: '/tmp/site',
			frontend: { framework: 'next', api: 'graphql' },
		} );

		expect( argValue( args, '--frontend' ) ).toBe( 'next' );
		expect( argValue( args, '--frontend-api' ) ).toBe( 'graphql' );
	} );

	it( 'defaults the frontend API to REST and omits both flags without a frontend', () => {
		expect(
			argValue(
				buildSiteCreateArgs( { path: '/tmp/site', frontend: { framework: 'astro' } } ).args,
				'--frontend-api'
			)
		).toBe( 'rest' );

		const { args } = buildSiteCreateArgs( { path: '/tmp/site' } );
		expect( args ).not.toContain( '--frontend' );
		expect( args ).not.toContain( '--frontend-api' );
	} );
} );
