import { describe, expect, it } from 'vitest';
import { describeOpenProblems, OpenProblems } from 'cli/ai/open-problems';

describe( 'OpenProblems', () => {
	it( 'raises each problem still open once, and the problems of the sites changed', async () => {
		const checked: string[] = [];
		const open = new OpenProblems( [
			async ( site ) => {
				checked.push( site );
				return `${ site } has a problem`;
			},
		] );
		open.record( '/a', '/a/page-1', 'page 1 is invalid' );
		open.record( '/a', '/a/page-2', 'page 2 is invalid' );
		open.record( '/a', '/a/page-2' );

		expect( await open.raise() ).toEqual( [ 'page 1 is invalid', '/a has a problem' ] );
		expect( checked ).toEqual( [ '/a' ] );
		expect( await open.raise() ).toEqual( [] );

		open.record( '/a', '/a/page-1', 'page 1 is still invalid' );
		expect( await open.raise() ).toEqual( [ 'page 1 is still invalid' ] );
	} );

	it( "tags the problems as Studio's checks", () => {
		expect( describeOpenProblems( [ 'a', 'b' ] ) ).toBe(
			'<studio-checks>\nStudio checked the sites this turn changed:\n- a\n- b\n</studio-checks>'
		);
	} );
} );
