import { describe, expect, it } from 'vitest';
import {
	CAPTURE_PRESETS,
	DEFAULT_SCENARIO_IDS,
	SCENARIO_IDS,
	THEMES,
	resolveSelection,
} from './presets.ts';

describe( 'capture presets', () => {
	it( 'keeps output dimensions in sync with viewport scale', () => {
		for ( const preset of Object.values( CAPTURE_PRESETS ) ) {
			expect( preset.output ).toEqual( {
				width: preset.viewport.width * preset.deviceScaleFactor,
				height: preset.viewport.height * preset.deviceScaleFactor,
			} );
		}
	} );

	it( 'includes the high-resolution source and store presets', () => {
		expect( CAPTURE_PRESETS[ 'raw-wide-2x' ].output ).toEqual( { width: 2880, height: 1800 } );
		expect( CAPTURE_PRESETS[ 'store-4k' ].output ).toEqual( { width: 3840, height: 2160 } );
	} );
} );

describe( 'resolveSelection', () => {
	it( 'uses defaults when no filter is supplied', () => {
		expect( resolveSelection( undefined, SCENARIO_IDS, DEFAULT_SCENARIO_IDS, 'scenario' ) ).toEqual(
			DEFAULT_SCENARIO_IDS
		);
	} );

	it( 'expands all and comma-separated filters', () => {
		expect( resolveSelection( [ 'all' ], THEMES, [ 'light' ], 'theme' ) ).toEqual( THEMES );
		expect( resolveSelection( [ 'dark, light', 'dark' ], THEMES, [ 'light' ], 'theme' ) ).toEqual( [
			'dark',
			'light',
		] );
	} );

	it( 'rejects unknown values with the available choices', () => {
		expect( () => resolveSelection( [ 'sepia' ], THEMES, THEMES, 'theme' ) ).toThrow(
			'Unknown theme "sepia". Available values: light, dark, all.'
		);
	} );
} );
