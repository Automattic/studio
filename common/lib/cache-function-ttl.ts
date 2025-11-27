const cache = new Map< () => Promise< unknown >, { result: unknown; timestamp: number } >();

export function cacheFunctionTTL< Args extends unknown[], Return >(
	fn: ( ...args: Args ) => Promise< Return >,
	ttl = 1 * 1000
) {
	return async ( ...args: Args ) => {
		const cachedValue = cache.get( fn );
		if ( cachedValue && Date.now() - cachedValue.timestamp < ttl ) {
			return cachedValue.result as Return;
		}
		const value = await fn( ...args );
		cache.set( fn, { result: value, timestamp: Date.now() } );
		return value;
	};
}
