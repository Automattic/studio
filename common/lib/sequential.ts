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
	const locks = new Set< Promise< Return > >();
	let queueCount = 0;

	return async ( ...args: Args ) => {
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
}
