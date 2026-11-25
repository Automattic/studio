import fs from 'node:fs';
import { lock, unlock } from 'proper-lockfile';
import { captureException } from './error-reporting';

// The holder refreshes the lock's mtime every half of this, so only a lock left by a process
// that died goes stale.
const STALE_TIME = 10_000;

// Studio 2.4 and older lock with a file at the same path, so a stale lock can be either kind.
const lockFs = {
	...fs,
	rmdir: ( lockPath: string, callback: fs.NoParamCallback ) =>
		fs.rm( lockPath, { recursive: true, force: true }, callback ),
};

export async function lockFileAsync( lockPath: string, { wait }: { wait: number } ) {
	await lock( lockPath, {
		lockfilePath: lockPath,
		realpath: false,
		fs: lockFs,
		stale: STALE_TIME,
		// `retry` reads a `maxRetryTime` of 0 as no limit.
		retries: wait > 0 ? { forever: true, factor: 1, minTimeout: 100, maxRetryTime: wait } : 0,
		onCompromised: captureException,
	} );
}

export async function unlockFileAsync( lockPath: string ) {
	try {
		await unlock( lockPath, { lockfilePath: lockPath, realpath: false, fs: lockFs } );
	} catch ( error ) {
		// A compromised lock was already reported and is no longer ours to remove.
		if ( ( error as NodeJS.ErrnoException ).code !== 'ENOTACQUIRED' ) {
			throw error;
		}
	}
}
