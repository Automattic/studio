import { describe, expect, it } from 'vitest';
import { getPostStatusInfo } from './post-status';

describe( 'getPostStatusInfo', () => {
	it( 'returns readable labels and dot colors for known WordPress statuses', () => {
		expect( getPostStatusInfo( 'publish' ) ).toEqual( {
			color: '#22c55e',
			label: 'Published',
		} );
		expect( getPostStatusInfo( 'future' ) ).toEqual( {
			color: '#3b82f6',
			label: 'Scheduled',
		} );
		expect( getPostStatusInfo( 'auto-draft' ) ).toEqual( {
			color: '#9ca3af',
			label: 'Draft',
		} );
	} );

	it( 'uses a neutral fallback for custom statuses', () => {
		expect( getPostStatusInfo( 'needs-review' ) ).toEqual( {
			color: '#9ca3af',
			label: 'needs-review',
		} );
	} );
} );
