import { __ } from '@wordpress/i18n';
import { PROTOCOL_PREFIX } from 'common/constants';
import WPCOM from 'wpcom';
import { z } from 'zod';
import { validateAccessToken } from 'cli/lib/api';
import { saveAppdata, readAppdata, lockAppdata, unlockAppdata } from 'cli/lib/appdata';
import { AuthToken } from 'cli/lib/token-waiter';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const meResponseSchema = z.object( {
	ID: z.number(),
	email: z.string(),
	display_name: z.string(),
} );

export function parseAuthUrl( url: string ): {
	accessToken: string;
	expiresIn?: number;
	state?: string;
} {
	const urlObject = new URL( url );

	if ( urlObject.protocol !== `${ PROTOCOL_PREFIX }:` || urlObject.hostname !== 'auth' ) {
		throw new Error( 'Invalid URL format. Expected wpcom-local-dev://auth#...' );
	}

	const hash = urlObject.hash;
	if ( ! hash || ! hash.startsWith( '#' ) ) {
		throw new Error( 'No authentication data found in URL' );
	}

	const params = new URLSearchParams( hash.substring( 1 ) );
	const error = params.get( 'error' );
	const errorDescription = params.get( 'error_description' );

	if ( error ) {
		const errorMessage = errorDescription || error;
		throw new Error( `Authentication failed: ${ errorMessage }` );
	}

	const accessToken = params.get( 'access_token' );
	const expiresIn = params.get( 'expires_in' );
	const state = params.get( 'state' );

	if ( ! accessToken ) {
		throw new Error( 'No access token found in URL' );
	}

	return {
		accessToken,
		expiresIn: expiresIn ? parseInt( expiresIn ) : undefined,
		state: state || undefined,
	};
}

export async function validateAndGetUserInfo( accessToken: string ): Promise< AuthToken > {
	await validateAccessToken( accessToken );

	const wpcom = new WPCOM( accessToken );
	const rawResponse = await wpcom.req.get( '/me?fields=ID,email,display_name' );
	const response = meResponseSchema.parse( rawResponse );

	const expiresIn = 3600; // Default to 1 hour
	const expirationTime = new Date().getTime() + expiresIn * 1000;

	return {
		accessToken,
		expiresIn,
		expirationTime,
		id: response.ID,
		email: response.email,
		displayName: response.display_name,
	};
}

export async function saveAuthToken( authToken: AuthToken, logger: Logger< string > ) {
	logger.reportStart( 'APPDATA_SAVE', __( 'Saving authentication…' ) );

	try {
		await lockAppdata();
		let userData;

		try {
			userData = await readAppdata();
		} catch {
			userData = {
				version: 1,
				newSites: [],
				sites: [],
				snapshots: [],
			};
		}

		userData.authToken = {
			accessToken: authToken.accessToken,
			id: authToken.id,
			expiresIn: authToken.expiresIn,
			expirationTime: authToken.expirationTime,
			email: authToken.email,
			displayName: authToken.displayName,
		};

		await saveAppdata( userData );
		logger.reportSuccess( __( 'Authentication saved successfully' ) );
	} finally {
		await unlockAppdata();
	}
}

export async function runCommand( url: string ): Promise< void > {
	const logger = new Logger();

	try {
		if ( ! url ) {
			throw new LoggerError( __( 'No callback URL provided' ) );
		}

		logger.reportStart( 'CALLBACK_PROCESS', __( 'Processing OAuth callback…' ) );

		const parsedAuth = parseAuthUrl( url );
		const { accessToken } = parsedAuth;
		logger.reportSuccess( __( 'OAuth callback parsed successfully' ) );

		logger.reportStart( 'TOKEN_VALIDATE', __( 'Validating access token…' ) );
		const authToken = await validateAndGetUserInfo( accessToken );
		logger.reportSuccess( __( 'Access token validated' ) );

		await saveAuthToken( authToken, logger );

		// Show success
		logger.reportSuccess( __( 'Authentication completed successfully!' ) );
		logger.reportKeyValuePair( 'status', __( 'Authenticated' ) );
		logger.reportKeyValuePair( 'user_id', authToken.id.toString() );
		logger.reportKeyValuePair( 'email', authToken.email );
		logger.reportKeyValuePair( 'display_name', authToken.displayName );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			logger.reportError( new LoggerError( __( 'OAuth callback processing failed' ), error ) );
		}

		// Exit with error code to indicate failure
		process.exit( 1 );
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'callback <url>',
		describe: __( 'Handle OAuth callback (internal use only)' ),
		builder: ( yargs ) => {
			return yargs.positional( 'url', {
				type: 'string',
				description: __( 'OAuth callback URL' ),
				demandOption: true,
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.url );
		},
	} );
};
