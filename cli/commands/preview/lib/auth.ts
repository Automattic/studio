import fs from 'fs';
import os from 'os';
import path from 'path';

export async function getAuthToken(): Promise< string | null > {
	const homeDir = os.homedir();
	const appDataPath = path.join(
		homeDir,
		'Library',
		'Application Support',
		'Studio',
		'appdata-v1.json'
	);

	if ( ! fs.existsSync( appDataPath ) ) {
		return null;
	}

	try {
		const userData = JSON.parse( fs.readFileSync( appDataPath, 'utf8' ) );
		return userData.authToken?.accessToken || null;
	} catch {
		return null;
	}
}
