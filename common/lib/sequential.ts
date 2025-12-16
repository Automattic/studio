type SequentialOptions = {
	concurrent?: number;
	max?: number;
};

export function sequential< Args extends unknown[], Return >(
	fn: ( ...args: Args ) => Promise< Return >,
	options?: SequentialOptions
) {
	const concurrentCount = options?.concurrent ?? 1;
	const maxQueueSize = options?.max;
	const locks = new Set< Promise< unknown > >();
	let queueCount = 0;

	return async ( ...args: Args ) => {
		if ( locks.size >= concurrentCount ) {
			if ( maxQueueSize !== undefined && queueCount >= maxQueueSize ) {
				throw new Error(
					`Queue is full (${ maxQueueSize } pending commands). Please try again later.`
				);
			}

			queueCount++;
			try {
				while ( locks.size >= concurrentCount ) {
					await Promise.allSettled( [ ...locks ] );
				}
			} finally {
				queueCount--;
			}
		}

		const fnPromise = fn( ...args );
		locks.add( fnPromise );

		try {
			return await fnPromise;
		} finally {
			locks.delete( fnPromise );
		}
	};
}
