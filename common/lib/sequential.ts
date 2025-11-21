const sequentialLocks = new Map< () => Promise< unknown >, Set< Promise< unknown > > >();

// Ensures that calls to the provided function are executed sequentially
export function sequential< Args extends unknown[], Return >(
	fn: ( ...args: Args ) => Promise< Return >
) {
	return async ( ...args: Args ) => {
		const locks = sequentialLocks.get( fn ) ?? new Set();
		if ( ! sequentialLocks.has( fn ) ) {
			sequentialLocks.set( fn, locks );
		}

		while ( locks.size ) {
			await Promise.allSettled( [ ...locks ] );
		}

		const fnPromise = fn( ...args );

		try {
			locks.add( fnPromise );
			return await fnPromise;
		} finally {
			locks.delete( fnPromise );
		}
	};
}
