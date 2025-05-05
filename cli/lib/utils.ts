import { promisify } from 'node:util';
import lockfile from 'lockfile';

export function normalizeHostname( hostname: string ): string {
	return hostname
		.trim()
		.toLowerCase()
		.replace( /^https?:\/\//, '' )
		.replace( /\/$/, '' );
}

export function lock( path: string, options: lockfile.Options ) {
	return new Promise< void >( ( resolve, reject ) => {
		lockfile.lock( path, options, ( err ) => {
			if ( err ) {
				reject( err );
			} else {
				resolve();
			}
		} );
	} );
}

export const unlock = promisify( lockfile.unlock );

export function withLock< Args extends unknown[], Return >(
	lockfilePath: string,
	fn: ( ...args: Args ) => Promise< Return >
) {
	return async ( ...args: Args ) => {
		try {
			await lock( lockfilePath, { wait: 1000 } );
			return await fn( ...args );
		} finally {
			await unlock( lockfilePath );
		}
	};
}
