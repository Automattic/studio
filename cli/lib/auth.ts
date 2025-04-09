import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';
import { readAppdata } from './appdata';

type AuthToken = {
	accessToken: string;
	id: number;
};

const AUTH_ERROR_MESSAGE = __(
	'Authentication required. Please run the Studio app and log in to WordPress.com first.'
);

export async function getAuthToken(): Promise< AuthToken > {
	try {
		const { authToken } = await readAppdata();

		if ( ! authToken || ! authToken.accessToken ) {
			throw new LoggerError( AUTH_ERROR_MESSAGE );
		}

		return authToken;
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}

		throw new LoggerError( AUTH_ERROR_MESSAGE );
	}
}
