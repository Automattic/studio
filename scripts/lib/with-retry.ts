import { Agent, fetch } from 'undici';

export { fetch };

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export const sharedDispatcher = new Agent( {
	connect: { timeout: DEFAULT_CONNECT_TIMEOUT_MS },
} );

export class NonRetriableError extends Error {}

export async function withRetry< T >(
	name: string,
	fn: () => Promise< T >,
	options: { maxAttempts?: number } = {}
): Promise< T > {
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	let lastError: Error | undefined;
	for ( let attempt = 1; attempt <= maxAttempts; attempt++ ) {
		try {
			return await fn();
		} catch ( error ) {
			lastError = error instanceof Error ? error : new Error( String( error ) );
			if ( lastError instanceof NonRetriableError ) {
				throw lastError;
			}
			if ( attempt < maxAttempts ) {
				const delayMs = 1000 * 2 ** ( attempt - 1 );
				console.warn(
					`[${ name }] Attempt ${ attempt }/${ maxAttempts } failed: ${ lastError.message }. Retrying in ${ delayMs }ms...`
				);
				await new Promise( ( resolve ) => setTimeout( resolve, delayMs ) );
			}
		}
	}
	throw lastError ?? new Error( `[${ name }] Failed after ${ maxAttempts } attempts` );
}

// 5xx and 429 are retriable; other 4xx are non-transient.
export function throwForHttpStatus( context: string, status: number, statusText?: string ): never {
	const message = `${ context } failed with status code: ${ status }${
		statusText ? ` ${ statusText }` : ''
	}`;
	if ( status < 500 && status !== 429 ) {
		throw new NonRetriableError( message );
	}
	throw new Error( message );
}
