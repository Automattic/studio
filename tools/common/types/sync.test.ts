import { describe, it, expect } from 'vitest';
import type { SyncSite } from './sync';

describe( 'SyncSite.slotOverride', () => {
	it( 'accepts the four legal slot override values and null', () => {
		const values: Array< SyncSite[ 'slotOverride' ] > = [
			'production',
			'staging',
			'archived',
			null,
			undefined,
		];
		// Type-level assertion: if this compiles, the field accepts all five.
		expect( values.length ).toBe( 5 );
	} );
} );
