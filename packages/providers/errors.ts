// The provider's config is missing or no longer works; the message says how
// to connect it.
export class ProviderNotReadyError extends Error {
	constructor( message: string ) {
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
