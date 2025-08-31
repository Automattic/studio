import fs from 'fs';
import { __ } from '@wordpress/i18n';
import { validateAccessToken } from 'cli/lib/api';
import { readAppdata } from 'cli/lib/appdata';
import { LoggerError, Logger } from 'cli/logger';

export interface AuthToken {
	accessToken: string;
	expiresIn: number;
	expirationTime: number;
	id: number;
	email: string;
	displayName: string;
}

/**
 * Wait for authentication token to be saved to appdata (unified for both desktop app and CLI callback)
 */
export async function waitForAuthenticationToken(
	initialTimestamp: number,
	timeoutMs: number = 120000,
	logger: Logger< string >
): Promise< AuthToken > {
	const startTime = Date.now();
	const pollInterval = 1000; // Poll every second

	logger.reportStart( 'TOKEN_WAIT', __( `Waiting for authentication…` ) );

	while ( Date.now() - startTime < timeoutMs ) {
		try {
			const userData: {
				authToken?: AuthToken;
			} = await readAppdata();

			if ( userData.authToken?.accessToken ) {
				// Check if this token was updated after we started waiting
				if ( userData.authToken.expirationTime > initialTimestamp ) {
					// Validate the token to make sure it's working
					try {
						await validateAccessToken( userData.authToken.accessToken );

						logger.reportSuccess( __( `Authentication received successfully` ) );

						return {
							accessToken: userData.authToken.accessToken,
							expiresIn: userData.authToken.expiresIn,
							expirationTime: userData.authToken.expirationTime,
							id: userData.authToken.id,
							email: userData.authToken.email,
							displayName: userData.authToken.displayName,
						};
					} catch ( tokenError ) {
						// Token is invalid, continue polling for a valid one
						logger.reportError(
							new LoggerError( __( 'Received invalid token, continuing to wait...' ) )
						);
					}
				}
			}
		} catch ( error ) {
			// Continue polling if there's an error reading appdata
			// The token might be in the process of being written
		}

		// Wait before next poll
		await new Promise( ( resolve ) => setTimeout( resolve, pollInterval ) );

		// Show progress every 10 seconds
		const elapsed = Date.now() - startTime;
		if ( elapsed % 10000 < pollInterval ) {
			const remaining = Math.round( ( timeoutMs - elapsed ) / 1000 );
			if ( remaining > 0 ) {
				logger.reportStart( 'TOKEN_WAIT', __( `Still waiting... (${ remaining }s remaining)` ) );
			}
		}
	}

	throw new LoggerError(
		__(
			`Timeout waiting for authentication. The protocol handler may not be responding or there may be an issue with the OAuth callback.`
		)
	);
}

/**
 * Get the current timestamp before starting authentication flow
 * Used to determine if a token was updated during the auth process
 */
export function getAuthStartTimestamp(): number {
	return Date.now();
}

/**
 * Watch for file system changes to the appdata file (alternative approach)
 * This is more efficient than polling but may not work on all platforms
 */
export async function waitForTokenWithFileWatcher(
	appdataPath: string,
	initialTimestamp: number,
	timeoutMs: number = 60000,
	logger: Logger< string >
): Promise< AuthToken > {
	return new Promise( ( resolve, reject ) => {
		const timeout = setTimeout( () => {
			watcher.close();
			reject( new LoggerError( __( 'Timeout waiting for authentication from desktop app' ) ) );
		}, timeoutMs );

		let watcher: fs.FSWatcher;

		const checkToken = async () => {
			try {
				const userData = await readAppdata();

				if (
					userData.authToken?.accessToken &&
					userData.authToken.expirationTime > initialTimestamp
				) {
					// Validate the token
					await validateAccessToken( userData.authToken.accessToken );

					clearTimeout( timeout );
					watcher.close();
					logger.reportSuccess( __( 'Authentication received from desktop app' ) );

					resolve( {
						accessToken: userData.authToken.accessToken,
						expiresIn: userData.authToken.expiresIn,
						expirationTime: userData.authToken.expirationTime,
						id: userData.authToken.id,
						email: userData.authToken.email,
						displayName: userData.authToken.displayName,
					} );
				}
			} catch {
				// Continue watching if validation fails
			}
		};

		try {
			watcher = fs.watch( appdataPath, { persistent: false }, async ( eventType ) => {
				if ( eventType === 'change' ) {
					await checkToken();
				}
			} );
		} catch ( error ) {
			clearTimeout( timeout );
			reject( new LoggerError( __( 'Failed to watch appdata file for changes' ), error ) );
		}
	} );
}
