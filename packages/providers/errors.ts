/**
 * Thrown by a provider's services when there is no config, or the provider no longer accepts it,
 * with a message for the user that says how to connect. Studio shows it. The Desktop app,
 * `studio ui` and the CLI also forget a config the provider rejected during an operation, so they
 * show the provider as disconnected; Studio on the web keeps it until the user disconnects it.
 */
export class NotConnectedError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'NotConnectedError';
	}
}

/**
 * Why connecting failed: the user declined (`denied`), what they gave or what came back is missing
 * or rejected (`invalid`), or the provider couldn't confirm it (`unverified`). Studio reports it in
 * analytics for the Studio sign-in; for any other provider it only shows the message.
 */
export type ConnectFailure = 'denied' | 'invalid' | 'unverified';

/**
 * Thrown by `account.connect` when connecting fails, with a message for the user, which surfaces
 * show where the user connects. Studio stores no config.
 */
export class ConnectError extends Error {
	constructor(
		message: string,
		readonly reason: ConnectFailure = 'invalid'
	) {
		super( message );
		this.name = 'ConnectError';
	}
}

/**
 * Thrown by a provider's `sites` services when a remote step fails, with a message for the user,
 * which surfaces show. `code` names the step for analytics, such as `site_fetch`, `site_create`,
 * `upload` or `remote_import`, and `cause` keeps the error behind it for the logs.
 */
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
