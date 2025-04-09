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

		throw new LoggerError(
			'Authentication required. Please run the Studio app and log in to WordPress.com first.'
		);
	}
}
