/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import { WORKBENCH_EXPAND_HEIGHT, WORKBENCH_EXPAND_WIDTH } from 'src/constants';
import { computeExpandedBounds } from '../window-expansion';

vi.mock( import( 'electron' ), async ( importActual ) => {
	const actual = await importActual();
	return {
		...actual,
		screen: {
			...actual.screen,
			getDisplayMatching: vi.fn(),
		},
	};
} );

const workArea = { x: 0, y: 25, width: 2560, height: 1415 };

describe( 'computeExpandedBounds', () => {
	it( 'grows a default-size window to the workbench size around its center', () => {
		const current = { x: 730, y: 322, width: 1100, height: 820 };
		const target = computeExpandedBounds( current, workArea );
		expect( target ).toEqual( {
			x: 730 + ( 1100 - WORKBENCH_EXPAND_WIDTH ) / 2,
			y: 322 + ( 820 - WORKBENCH_EXPAND_HEIGHT ) / 2,
			width: WORKBENCH_EXPAND_WIDTH,
			height: WORKBENCH_EXPAND_HEIGHT,
		} );
	} );

	it( 'returns null when the window is already large enough', () => {
		const current = { x: 100, y: 100, width: 1600, height: 1000 };
		expect( computeExpandedBounds( current, workArea ) ).toBeNull();
	} );

	it( 'never shrinks an axis that is already larger than the target', () => {
		const current = { x: 100, y: 100, width: 1600, height: 700 };
		const target = computeExpandedBounds( current, workArea );
		expect( target?.width ).toBe( 1600 );
		expect( target?.height ).toBe( WORKBENCH_EXPAND_HEIGHT );
	} );

	it( 'clamps to the work area on small displays', () => {
		const smallWorkArea = { x: 0, y: 25, width: 1280, height: 775 };
		const current = { x: 90, y: 25, width: 1100, height: 775 };
		const target = computeExpandedBounds( current, smallWorkArea );
		expect( target ).toEqual( { x: 0, y: 25, width: 1280, height: 775 } );
	} );

	it( 'keeps the window inside the work area when growth would overflow an edge', () => {
		const current = { x: 2560 - 1100, y: 25, width: 1100, height: 820 };
		const target = computeExpandedBounds( current, workArea );
		expect( target ).not.toBeNull();
		if ( ! target ) {
			return;
		}
		expect( target.x + target.width ).toBeLessThanOrEqual( workArea.x + workArea.width );
		expect( target.y ).toBeGreaterThanOrEqual( workArea.y );
		expect( target.y + target.height ).toBeLessThanOrEqual( workArea.y + workArea.height );
	} );
} );
