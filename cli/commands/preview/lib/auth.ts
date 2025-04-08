import { z } from 'zod';
import { LoggerError } from 'cli/logger';
import { readAppdata } from './appdata';

export async function getAuthToken(): Promise< string > {
	try {
		const { authToken } = await readAppdata();

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
