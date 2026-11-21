import { describe, expect, it, vi } from 'vitest';
import { validateBlocks } from '@studio/agent/node/block-validator';
import { openPage } from '@studio/agent/node/pages';

vi.mock( '@studio/agent/node/pages', () => ( { openPage: vi.fn() } ) );

describe( 'validateBlocks', () => {
	it( 'loads the block editor once for concurrent validations', async () => {
		const report = { totalBlocks: 0, validBlocks: 0, invalidBlocks: 0, results: [] };
		vi.mocked( openPage ).mockResolvedValue( {
			waitForFunction: vi.fn(),
			evaluate: vi.fn().mockResolvedValue( { report } ),
			isClosed: () => false,
			close: vi.fn(),
		} as never );

		const reports = await Promise.all(
			[ 1, 2, 3 ].map( () => validateBlocks( '', 'http://localhost:8882' ) )
		);

		expect( reports ).toEqual( [ report, report, report ] );
		expect( openPage ).toHaveBeenCalledTimes( 1 );
		expect( openPage ).toHaveBeenCalledWith( {
			url: 'http://localhost:8882/wp-admin/post-new.php',
			signIn: true,
		} );
	} );
} );
