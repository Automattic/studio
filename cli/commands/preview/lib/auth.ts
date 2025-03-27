import fs from 'fs';
import os from 'os';
import path from 'path';
import { LoggerError } from 'cli/logger';

export async function getAuthToken( action: string ): Promise< string > {
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
			'Authentication required. Please run the Studio app and authenticate first.',
			action
		);
	}

	try {
		const userData = JSON.parse( fs.readFileSync( appDataPath, 'utf8' ) );
		const token = userData.authToken?.accessToken;

		if ( ! token ) {
			throw new LoggerError(
				'Authentication required. Please run the Studio app and authenticate first.',
				action
			);
		}

		return token;
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			throw error;
		}
		throw new LoggerError(
			'Authentication required. Please run the Studio app and authenticate first.',
			action
		);
	}
}
