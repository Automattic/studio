type SequentialOptions< Args extends unknown[] > = {
	concurrent?: number;
	max?: number;
	deduplicateKey?: ( ...args: Args ) => string | undefined;
};

export function sequential< Args extends unknown[], Return >(
	fn: ( ...args: Args ) => Promise< Return >,
	options?: SequentialOptions< Args >
) {
	const concurrentCount = options?.concurrent ?? 1;
	const maxQueueSize = options?.max;
	const deduplicateKey = options?.deduplicateKey;
	const locks = new Set< Promise< Return > >();
	const inFlightByKey = new Map< string, Promise< Return > >();
	let queueCount = 0;

	return async ( ...args: Args ) => {
		const key = deduplicateKey?.( ...args );
		if ( key ) {
			const existing = inFlightByKey.get( key );
			if ( existing ) {
				return existing;
			}
		}

		// Wrap the full lifecycle (queue wait + execution) so dedup covers
		// calls arriving while this one is still waiting for a concurrent slot.
		// Note: deduped callers share the first caller's AbortSignal behavior.
		const execute = async () => {
			if ( maxQueueSize !== undefined && queueCount >= maxQueueSize ) {
				throw new Error(
					`Queue is full (${ maxQueueSize } pending commands). Please try again later.`
				);
			}

			while ( locks.size >= concurrentCount ) {
				queueCount++;
				await Promise.allSettled( [ ...locks ] );
				queueCount--;
			}

			const fnPromise = fn( ...args );
			try {
				locks.add( fnPromise );
				return await fnPromise;
			} finally {
				locks.delete( fnPromise );
			}
		};

		const resultPromise = execute();
		if ( key ) {
			inFlightByKey.set( key, resultPromise );
			const cleanup = () => inFlightByKey.delete( key );
			resultPromise.then( cleanup, cleanup );
		}

		return resultPromise;
	};
}
