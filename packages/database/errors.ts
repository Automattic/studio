export type DatabaseErrorCode = 'connection_failed' | 'query_failed' | 'socket_host';

/** A database failure, with a translated message to show and a code to classify it by. */
export class DatabaseError extends Error {
	readonly cause?: unknown;

	constructor(
		message: string,
		readonly code: DatabaseErrorCode,
		options: { cause?: unknown } = {}
	) {
		super( message );
		this.name = 'DatabaseError';
		this.cause = options.cause;
	}
}
