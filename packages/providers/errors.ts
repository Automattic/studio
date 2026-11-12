// The provider's config is missing or no longer works; the message says how
// to connect it.
export class ProviderNotReadyError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'ProviderNotReadyError';
	}
}

// Why connecting failed: the user declined, what came back is missing or
// rejected, or the provider couldn't confirm it.
export type ConnectFailure = 'denied' | 'invalid' | 'unverified';

// Connecting failed; the message is for the user.
export class InvalidCredentialError extends Error {
	constructor(
		message: string,
		readonly reason: ConnectFailure = 'invalid'
	) {
		super( message );
		this.name = 'InvalidCredentialError';
	}
}

// A remote site operation failed; the message is for the user, and `code`
// names the cause for analytics, such as `upload` or `remote_import`.
export class RemoteSiteError extends Error {
	readonly cause?: unknown;

	constructor(
		message: string,
		readonly code?: string,
		options?: { cause?: unknown }
	) {
		super( message );
		this.name = 'RemoteSiteError';
		this.cause = options?.cause;
	}
}
