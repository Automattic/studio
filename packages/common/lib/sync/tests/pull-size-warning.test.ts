import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYNC_PUSH_SIZE_LIMIT_BYTES } from '@studio/common/lib/sync/constants';
import { isSiteOverPushSizeLimit } from '@studio/common/lib/sync/pull-size-warning';

const { calculateDirectorySizeForArchive } = vi.hoisted( () => ( {
	calculateDirectorySizeForArchive: vi.fn(),
} ) );

// The limit is 5 GB, so the tally is stubbed rather than written to disk.
vi.mock( '@studio/common/lib/fs-utils', () => ( { calculateDirectorySizeForArchive } ) );

function makeSite(): string {
	const sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pull-size-' ) );
	fs.mkdirSync( path.join( sitePath, 'wp-content' ), { recursive: true } );
	return sitePath;
}

afterEach( () => {
	vi.clearAllMocks();
} );

describe( 'isSiteOverPushSizeLimit', () => {
	it( 'measures wp-content through the deploy-ignore filter', async () => {
		const sitePath = makeSite();
		calculateDirectorySizeForArchive.mockResolvedValue( 1024 );

		await isSiteOverPushSizeLimit( sitePath );

		expect( calculateDirectorySizeForArchive ).toHaveBeenCalledWith(
			path.join( sitePath, 'wp-content' ),
			expect.anything(),
			'wp-content'
		);

		fs.rmSync( sitePath, { recursive: true, force: true } );
	} );

	it( 'reports a site over the limit', async () => {
		const sitePath = makeSite();
		calculateDirectorySizeForArchive.mockResolvedValue( SYNC_PUSH_SIZE_LIMIT_BYTES + 1 );

		expect( await isSiteOverPushSizeLimit( sitePath ) ).toBe( true );

		fs.rmSync( sitePath, { recursive: true, force: true } );
	} );

	it( 'stays quiet for a site exactly at the limit', async () => {
		const sitePath = makeSite();
		calculateDirectorySizeForArchive.mockResolvedValue( SYNC_PUSH_SIZE_LIMIT_BYTES );

		expect( await isSiteOverPushSizeLimit( sitePath ) ).toBe( false );

		fs.rmSync( sitePath, { recursive: true, force: true } );
	} );
} );
