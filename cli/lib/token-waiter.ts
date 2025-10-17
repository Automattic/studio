import fs from 'fs';
import path from 'path';
import { __ } from '@wordpress/i18n';
import {
	getAppdataPath,
	readAppdata,
	saveAppdata,
	lockAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { LoggerError, Logger } from 'cli/logger';

interface AuthToken {
	accessToken: string;
	id: number;
	email?: string;
	displayName?: string;
	expiresIn?: number;
	expirationTime?: number;
}

/**
 * Get timestamp to use as auth start time for token detection
 */
export function getAuthStartTimestamp(): number {
	return Date.now();
}

/**
 * Wait for authentication token to be saved to appdata
 * @param authStartTime - Timestamp when auth flow started
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param logger - Logger instance for progress reporting
 */
export async function waitForAuthenticationToken(
	authStartTime: number,
	timeoutMs: number = 120000,
	logger?: Logger
): Promise< AuthToken > {
	const startTime = Date.now();
	const maxWaitMs = timeoutMs;
	let lastTokenState: string | undefined;

	while ( Date.now() - startTime < maxWaitMs ) {
		try {
			// Check if appdata file exists
			const appDataPath = getAppdataPath();
			if ( ! fs.existsSync( appDataPath ) ) {
				await new Promise( ( resolve ) => setTimeout( resolve, 2000 ) );
				continue;
			}

			const userData = await readAppdata();
			const currentToken = userData.authToken?.accessToken;

			// Check if we have a new token that wasn't there when auth started
			if ( currentToken && currentToken !== lastTokenState ) {
				const tokenCreationTime = userData.authToken?.expirationTime
					? userData.authToken.expirationTime - ( userData.authToken.expiresIn || 3600 ) * 1000
					: Date.now();

				// Only accept tokens created after auth flow started
				if ( tokenCreationTime >= authStartTime - 5000 ) {
					// 5 second buffer
					logger?.reportSuccess( __( 'Authentication token received' ) );
					return userData.authToken as AuthToken;
				}
			}

			if ( lastTokenState === undefined ) {
				lastTokenState = currentToken;
			}
		} catch ( error ) {
			// If appdata doesn't exist or can't be read, keep waiting
			if ( error instanceof LoggerError && error.message.includes( 'config file not found' ) ) {
				// This is expected during initial auth flow
			} else {
				logger?.reportError(
					new LoggerError( __( 'Error checking authentication status' ), error )
				);
			}
		}

		await new Promise( ( resolve ) => setTimeout( resolve, 2000 ) );
	}

	throw new LoggerError( __( 'Authentication timeout. Please try again.' ) );
}

/**
 * Save authentication token to appdata
 * @param tokenData - Token data received from OAuth callback
 */
export async function saveAuthenticationToken( tokenData: {
	access_token: string;
	user_id: number;
	email?: string;
	display_name?: string;
	expires_in?: number;
} ): Promise< void > {
	try {
		await lockAppdata();

		// Ensure appdata directory exists
		const appDataPath = getAppdataPath();
		const appDataDir = path.dirname( appDataPath );
		await fs.promises.mkdir( appDataDir, { recursive: true } );

		let userData;
		try {
			userData = await readAppdata();
		} catch ( error ) {
			// If appdata doesn't exist, create new user data
			if ( error instanceof LoggerError && error.message.includes( 'config file not found' ) ) {
				userData = {
					newSites: [],
					sites: [],
					snapshots: [],
					version: 1,
				};
			} else {
				throw error;
			}
		}

		const authToken: AuthToken = {
			accessToken: tokenData.access_token,
			id: tokenData.user_id,
			email: tokenData.email,
			displayName: tokenData.display_name,
			expiresIn: tokenData.expires_in,
			expirationTime: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
		};

		userData.authToken = authToken;
		await saveAppdata( userData );
	} finally {
		await unlockAppdata();
	}
}
