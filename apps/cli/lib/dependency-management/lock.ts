import { mkdir } from 'fs/promises';
import path from 'path';
import { lockFileAsync, unlockFileAsync } from '@studio/common/lib/lockfile';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';

// Far more patient than the config-file locks: the guarded work downloads and
// copies a full WordPress release, which takes minutes on a slow connection.
const STALE_TIME = 10 * 60 * 1000;
const WAIT_TIME = 2 * 60 * 1000;

function getLockfilePath(): string {
	return path.join( getServerFilesPath(), 'wordpress-versions.lock' );
}

/**
 * Serialize access to `wordpress-versions/`. The `latest` directory is shared
 * mutable state: a refresh rewrites it in place, while a site create may be
 * copying files out of it at the same time. Without this, a create started
 * just as a new WordPress release lands can copy a half-written directory.
 */
export async function withWordPressVersionsLock< T >( run: () => Promise< T > ): Promise< T > {
	const lockfilePath = getLockfilePath();
	await mkdir( path.dirname( lockfilePath ), { recursive: true } );
	await lockFileAsync( lockfilePath, { stale: STALE_TIME, wait: WAIT_TIME } );

	try {
		return await run();
	} finally {
		await unlockFileAsync( lockfilePath );
	}
}
