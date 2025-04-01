import { z } from 'zod';
import { LoggerError } from 'cli/logger';
import { readAppdata } from './appdata';

const AuthTokenSchema = z.object( {
	authToken: z
		.object( {
			accessToken: z.string().min( 1, 'Access token cannot be empty' ),
		} )
		.nullable(),
} );

export async function getAuthToken(): Promise< string > {
	try {
		const userData = await readAppdata();
		const { authToken } = AuthTokenSchema.parse( userData );

		if ( ! authToken || ! authToken.accessToken ) {
			throw new LoggerError(
				'Authentication required. Please run the Studio app and log in to WordPress.com first.'
			);
		}

		return authToken.accessToken;
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		if ( error instanceof z.ZodError ) {
			throw new LoggerError(
				`Authentication token is invalid or missing. Please run the Studio app and log in to WordPress.com again.`
			);
		}

		throw new LoggerError(
			'Authentication required. Please run the Studio app and log in to WordPress.com first.'
		);
	}
}
