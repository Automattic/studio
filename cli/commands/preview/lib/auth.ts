import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

// Define Zod schema for authentication token validation
const AuthTokenSchema = z.object( {
	authToken: z
		.object( {
			accessToken: z.string().min( 1, 'Access token cannot be empty' ),
		} )
		.nullable(),
} );

export async function getAuthToken(): Promise< string > {
	const homeDir = os.homedir();
	const appDataPath = path.join(
		homeDir,
		'Library',
		'Application Support',
		'Studio',
		'appdata-v1.json'
	);

	if ( ! fs.existsSync( appDataPath ) ) {
		throw new LoggerError(
			'Authentication required. Please run the Studio app and authenticate first.'
		);
	}

	try {
		const fileContent = fs.readFileSync( appDataPath, 'utf8' );
		const userData = JSON.parse( fileContent );

		// Validate the userData against our schema
		const result = AuthTokenSchema.safeParse( userData );

		if ( ! result.success ) {
			// Format the error in a more user-friendly way
			throw new LoggerError(
				`Authentication data is invalid. Please run the Studio app and authenticate again.`
			);
		}

		const { authToken } = result.data;

		if ( ! authToken || ! authToken.accessToken ) {
			throw new LoggerError(
				'Authentication required. Please run the Studio app and authenticate first.'
			);
		}

		return authToken.accessToken;
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		if ( error instanceof z.ZodError ) {
			throw new LoggerError(
				`Authentication token is invalid or missing. Please run the Studio app and authenticate again.`
			);
		}

		if ( error instanceof SyntaxError ) {
			throw new LoggerError(
				'Authentication data is corrupted. Please run the Studio app and authenticate again.'
			);
		}

		throw new LoggerError(
			'Authentication required. Please run the Studio app and authenticate first.'
		);
	}
}
