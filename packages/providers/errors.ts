import type { AccountMethod, ProviderId } from './types';

// The provider's config is missing or no longer works. The command that made
// the call asks the user to connect with one of `methods`.
export class ProviderNotReadyError extends Error {
	constructor(
		readonly provider: ProviderId,
		readonly methods: readonly AccountMethod[],
		message: string
	) {
		super( message );
		this.name = 'ProviderNotReadyError';
	}
}

// The provider definitively rejected a credential; the message is for the user.
export class InvalidCredentialError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'InvalidCredentialError';
	}
}
