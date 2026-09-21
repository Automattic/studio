import { describe, expect, it } from 'vitest';
import { formatProgressLabel } from '../progress-label';

describe( 'formatProgressLabel', () => {
	it( 'leads with the percentage so the number stays put as the label changes', () => {
		expect( formatProgressLabel( 'Creating remote backup…', 3 ) ).toBe(
			'03% · Creating remote backup…'
		);
		expect( formatProgressLabel( 'Downloading backup…', 50 ) ).toBe( '50% · Downloading backup…' );
	} );

	// The label is rewritten in place while an operation runs, so a single digit
	// growing to two would shift everything after it.
	it( 'pads single digits to a fixed two', () => {
		expect( formatProgressLabel( 'Extracting…', 0 ) ).toBe( '00% · Extracting…' );
		expect( formatProgressLabel( 'Extracting…', 9 ) ).toBe( '09% · Extracting…' );
		expect( formatProgressLabel( 'Extracting…', 10 ) ).toBe( '10% · Extracting…' );
		expect( formatProgressLabel( 'Extracting…', 100 ) ).toBe( '100% · Extracting…' );
	} );

	it( 'rounds fractional progress', () => {
		expect( formatProgressLabel( 'Uploading archive…', 24.6 ) ).toBe( '25% · Uploading archive…' );
	} );
} );
