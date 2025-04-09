import { LoggerError } from 'cli/logger';
import { readAppdata } from './appdata';

type AuthToken = {
	accessToken: string;
	id: number;
};

export async function getAuthToken(): Promise< AuthToken > {
	try {
		const { authToken } = await readAppdata();

		if ( ! authToken || ! authToken.accessToken ) {
			throw new LoggerError(
				'Authentication required. Please run the Studio app and log in to WordPress.com first.'
			);
		}

		return authToken;
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		throw new LoggerError(
			'Authentication required. Please run the Studio app and log in to WordPress.com first.'
		);
	}
}
