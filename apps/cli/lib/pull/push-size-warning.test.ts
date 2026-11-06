import fs from 'fs';
import os from 'os';
import path from 'path';
import { SYNC_PUSH_SIZE_LIMIT_BYTES } from '@studio/common/lib/sync/constants';
import { expect, it } from 'vitest';
import { getPushSizeWarning } from './push-size-warning';

it.each( [
	[ 'at', SYNC_PUSH_SIZE_LIMIT_BYTES, false ],
	[ 'over', SYNC_PUSH_SIZE_LIMIT_BYTES + 1, true ],
] )( 'warns only when wp-content is over the push limit: %s it', async ( _, size, warns ) => {
	const site = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-size-' ) );
	const upload = path.join( site, 'wp-content', 'uploads', 'video.mp4' );
	fs.mkdirSync( path.dirname( upload ), { recursive: true } );
	fs.writeFileSync( upload, '' );
	// Sparse, so the file has the size without taking the disk space.
	fs.truncateSync( upload, size );

	expect( Boolean( await getPushSizeWarning( site ) ) ).toBe( warns );
	fs.rmSync( site, { recursive: true } );
} );
