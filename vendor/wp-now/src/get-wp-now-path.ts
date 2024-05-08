import path from 'path';
import getWpNowTmpPath from './get-wp-now-tmp-path';
import { getServerFilesPath } from '../../../src/storage/paths';

const inSiteServerProcess = () => process.env.STUDIO_SITE_SERVER_PROCESS === 'true';

export default function getWpNowPath() {
	if (process.env.NODE_ENV !== 'test') {
		if ( inSiteServerProcess() ) {
			if ( ! process.env.STUDIO_APP_DATA_PATH || ! process.env.STUDIO_APP_NAME ) {
				throw Error( "Studio's process environment variables not defined for site server process" );
			}
			const appDataPath = process.env.STUDIO_APP_DATA_PATH;
			return path.join( appDataPath, process.env.STUDIO_APP_NAME, 'server-files' );
		}
		return getServerFilesPath()
	}

	return getWpNowTmpPath();
}
