import fastDeepEqual from 'fast-deep-equal';

const cache = new Map<
	() => Promise< unknown >,
	Set< { args: unknown[]; result: unknown; timestamp: number } >
>();

export function cacheFunctionTTL< Args extends unknown[], Return >(
	fn: ( ...args: Args ) => Promise< Return >,
	ttl = 1 * 1000
) {
	return async ( ...args: Args ) => {
		const cachedResults = cache.get( fn ) ?? new Set();

		if ( ! cache.has( fn ) ) {
			cache.set( fn, cachedResults );
		}

		for ( const cachedResult of cachedResults ) {
			if ( fastDeepEqual( args, cachedResult.args ) && Date.now() - cachedResult.timestamp < ttl ) {
				return cachedResult.result as Return;
			}
		}

		const value = await fn( ...args );
		cachedResults.add( { args, result: value, timestamp: Date.now() } );
		return value;
	};
}
