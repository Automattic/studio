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
} );
