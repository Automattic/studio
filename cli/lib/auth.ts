import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';
import { readAppdata } from './appdata';

type AuthToken = {
	accessToken: string;
	id: number;
};

export async function getAuthToken(): Promise< AuthToken > {
	const { authToken } = await readAppdata();

	if ( ! authToken?.accessToken ) {
		throw new LoggerError(
			__( 'Authentication required. Please run the Studio app and log in to WordPress.com first.' )
		);
	}

	return authToken;
}
