import { describe, expect, it, vi } from 'vitest';
import { validateBlocks } from '@studio/agent/shared/block-validator';
import type { HostPages } from '@studio/agent/shared/host';

describe( 'validateBlocks', () => {
	it( 'loads the block editor once for concurrent validations', async () => {
		const report = { totalBlocks: 0, validBlocks: 0, invalidBlocks: 0, results: [] };
		const page = {
			waitFor: vi.fn(),
			evaluate: vi.fn().mockResolvedValue( { report } ),
			isClosed: () => false,
			close: vi.fn(),
		};
		const pages = { open: vi.fn().mockResolvedValue( page ), fetchText: vi.fn() };

		const reports = await Promise.all(
			[ 1, 2, 3 ].map( () =>
				validateBlocks( pages as unknown as HostPages, '', 'http://localhost:8882' )
			)
		);

		expect( reports ).toEqual( [ report, report, report ] );
		expect( pages.open ).toHaveBeenCalledTimes( 1 );
		expect( pages.open ).toHaveBeenCalledWith( {
			url: 'http://localhost:8882/wp-admin/post-new.php',
			signIn: true,
		} );
	} );
} );
