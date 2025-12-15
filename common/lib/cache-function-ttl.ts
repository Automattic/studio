import fastDeepEqual from 'fast-deep-equal';

const cache = new Map<
	() => Promise< unknown >,
	Set< { args: unknown[]; result: unknown; timestamp: number; ttl: number } >
>();

export function cacheFunctionTTL< Args extends unknown[], Return >(
	fn: ( ...args: Args ) => Promise< Return >,
	ttl = 1 * 1000
) {
	return async ( ...args: Args ) => {
		pruneCache();

		const cachedResults = cache.get( fn ) ?? new Set();

		if ( ! cache.has( fn ) ) {
			cache.set( fn, cachedResults );
		}

		for ( const cachedResult of cachedResults ) {
			if ( fastDeepEqual( args, cachedResult.args ) ) {
				return cachedResult.result as Return;
			}
		}

		const value = await fn( ...args );
		cachedResults.add( { args, result: value, timestamp: Date.now(), ttl } );
		return value;
	};
}

function pruneCache(): void {
	for ( const [ _, cachedResults ] of cache ) {
		for ( const cachedResult of cachedResults ) {
			if ( Date.now() - cachedResult.timestamp >= cachedResult.ttl ) {
				cachedResults.delete( cachedResult );
			}
		}
	}
}

export function clearCache(): void {
	cache.clear();
}
